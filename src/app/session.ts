import { clonePlain } from '../core/clone.ts';
import { gameVersions } from '../core/versions.ts';
import { RULE_QUERIES } from '../ai/query.ts';
import { rememberCityRejection } from '../ai/memory.ts';
import type { RejectedCitySite } from '../ai/memory.ts';
import { planNext } from '../ai/plan.ts';
import { isMapUnit } from '../core/model.ts';
import { deserializeSave, serializeSave } from './save.ts';
import { contentFor, isStockContent } from '../content/units.ts';
import type { Content } from '../content/units.ts';
import { createGame } from '../core/game.ts';
import { cityCounterAttack } from '../core/city.ts';
import type { Command, GameSetup, GameState, PlayerView, StepResult, VisibleEvent } from '../core/model.ts';
import { observe, projectEvents } from '../core/vision.ts';
import { step } from '../core/step.ts';
import { canonicalSerialize } from '../core/snapshot.ts';
import { observeWorld } from '../core/world-systems.ts';
import { observeCivilization } from '../core/civilization-systems.ts';
import { CIVILIZATION_CONTENT } from '../content/civilization-systems.ts';

export type CommandLog = { version: 1; schemaVersion: GameState['schemaVersion']; rulesVersion: GameState['rulesVersion']; contentVersion: string; setup: GameSetup; commands: Command[]; aiRejectedCitySites?: RejectedCitySite[] };

export function replay(log: CommandLog, through = log.commands.length, checkpoint?: GameState, content: Content = contentFor(log.setup)): GameState {
  const versions = gameVersions();
  if (log.version !== 1 || log.schemaVersion !== versions.schemaVersion || log.rulesVersion !== versions.rulesVersion || log.contentVersion !== content.version
    || !Number.isInteger(through) || through < 0 || through > log.commands.length) throw new Error('Unsupported log or replay sequence.');
  let state = createGame(log.setup, content);
  if (checkpoint) {
    if (checkpoint.schemaVersion !== log.schemaVersion || !Number.isSafeInteger(checkpoint.commandSeq)
      || checkpoint.commandSeq < 0 || checkpoint.commandSeq > through) throw new Error('Checkpoint does not match this log.');
    const source = replay(log, checkpoint.commandSeq, undefined, content);
    if (canonicalSerialize(source) !== canonicalSerialize(checkpoint)) throw new Error('Checkpoint does not match this log prefix.');
    state = clonePlain(checkpoint);
  }
  for (const command of log.commands.slice(state.commandSeq, through)) {
    const result = step(state, command, content);
    if (!result.ok) throw new Error(`Replay rejected at ${state.commandSeq}: ${result.reason}`);
    state = result.state;
  }
  return state;
}

/** Full authority state for developer tools and tests; never a player-facing observation. */
export type DeveloperGameState = GameState;
/** Command results from legacy developer entry points contain full state. */
export type DeveloperStepResult = StepResult;
export type PlayerCommandResult = { ok: true } | { ok: false; reason: string };
export interface PlayerSession {
  getView(): PlayerView;
  /** Read-only cached view for high-frequency callers (hover tooltips, animation frames); never mutate. */
  peekView?(): PlayerView;
  readonly presentationQueue: readonly VisibleEvent[];
  issue(action: Command['action']): PlayerCommandResult;
  submit(command: Command): PlayerCommandResult;
  skipAnimations(): void;
}
export class GameSession {
  private state: GameState;
  private content: Content;
  private observedState: GameState | null = null;
  private cachedView: PlayerView | null = null;
  private commands: Command[] = [];
  private aiRejectedCitySites: RejectedCitySite[] = [];
  get playerId(): number { return this.state.setup.players.find(player => player.controller === 'human')!.id; }
  presentationQueue: VisibleEvent[] = [];
  lastRejected: { command: Command; reason: string } | null = null;

  constructor(setup: GameSetup, content: Content = contentFor(setup)) {
    this.content = content;
    this.state = createGame(setup, content);
    this.endComputerTurns();
  }
  /** @deprecated Developer/test access only. Production UI must use getView or asPlayerSession. */
  getState(): DeveloperGameState { return clonePlain(this.state); }
  /** Cached player view detached from authority state; callers must not mutate it. */
  peekView(): PlayerView {
    if (this.observedState !== this.state || !this.cachedView) {
      this.cachedView = observe(this.state, this.playerId, this.content);
      this.observedState = this.state;
    }
    return this.cachedView;
  }
  getView(): PlayerView {
    return structuredClone(this.peekView());
  }
  /** Explicit developer omniscient view; never pass this to AI. */
  getDebugView(): PlayerView {
    const view = this.peekView();
    const state = this.getState();
    const allTiles = state.map.tiles.map((_, i) => i);
    return { ...view, map: state.map, visibleTileIds: state.map.tiles.map((_, i) => i),
      units: Object.values(state.units).filter(isMapUnit), cities: Object.values(state.cities),
      ...(state.expansion ? { expansion: { ...view.expansion!, world: observeWorld(state, this.playerId, new Set(allTiles)),
        civilization: observeCivilization(state, this.playerId, new Set(allTiles), { ...CIVILIZATION_CONTENT, world: this.content }) } } : {}),
      combat: {
        units: Object.fromEntries(Object.values(state.units).filter(isMapUnit).map(unit => [unit.id, { typeResearch: unit.ownerId !== null && state.players[unit.ownerId].research.unlockedIds.includes('typeResearch') }])),
        cities: Object.fromEntries(Object.values(state.cities).map(city => [city.id, { hp: city.hp, counterAttack: cityCounterAttack(city.ownerId === null ? undefined : state.players[city.ownerId], this.content) }])),
      } };
  }
  exportLog(): CommandLog {
    return { version: 1, ...gameVersions(), contentVersion: this.content.version, setup: clonePlain(this.state.setup),
      commands: clonePlain(this.commands),
      aiRejectedCitySites: clonePlain(this.aiRejectedCitySites) };
  }
  /** Developer-compatible result; asPlayerSession strips full authority state. */
  issue(action: Command['action']): DeveloperStepResult {
    return this.submit({ actorId: this.playerId, expectedSeq: this.state.commandSeq, action });
  }
  /** Developer-compatible result; normal player callers should use asPlayerSession. */
  submit(command: Command): DeveloperStepResult {
    const result = this.apply(command);
    if (result.ok) this.endComputerTurns();
    return result.ok ? { ...result, state: clonePlain(result.state) } : result;
  }
  private apply(command: Command): StepResult {
    const before = this.state;
    const result = step(before, command, this.content);
    if (!result.ok) this.lastRejected = { command: clonePlain(command), reason: result.reason };
    else {
      if (before.commandSeq < this.commands.length) this.aiRejectedCitySites = this.aiRejectedCitySites.filter(site => site.seq < before.commandSeq);
      this.state = result.state;
      this.commands = this.commands.slice(0, before.commandSeq);
      this.commands.push(clonePlain(command));
      this.presentationQueue.push(...projectEvents(before, this.state, result.events, this.playerId, this.content));
    }
    return result;
  }
  readonly aiInvalidCommands: { command: Command; reason: string }[] = [];
  private endComputerTurns(): void {
    while (!this.state.outcome && this.state.players[this.state.activePlayerId].controller === 'ai') {
      const view = observe(this.state, this.state.activePlayerId, this.content);
      const command = planNext(view, { ...RULE_QUERIES, content: this.content }, this.aiRejectedCitySites);
      const result = this.apply(command);
      if (!result.ok) {
        this.aiInvalidCommands.push({ command, reason: result.reason });
        rememberCityRejection(this.aiRejectedCitySites, view, command, result.reason);
        // End this turn safely; the next turn avoids the rejected site using only this AI's observation.
        this.apply({ actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'EndTurn' } });
      }
    }
  }
  asPlayerSession(): PlayerSession {
    const getPresentation = () => clonePlain(this.presentationQueue);
    const project = (result: StepResult): PlayerCommandResult => result.ok ? { ok: true } : { ok: false, reason: result.reason };
    return {
      getView: () => this.getView(),
      peekView: () => this.peekView(),
      get presentationQueue() { return getPresentation(); },
      issue: action => project(this.issue(action)), submit: command => project(this.submit(command)),
      skipAnimations: () => this.skipAnimations(),
    };
  }
  save(): string { return serializeSave(this.getState(), this.exportLog()); }
  load(text: string): void {
    const stock = isStockContent(this.content);
    const save = deserializeSave(text, stock ? undefined : this.content);
    if (stock) this.content = contentFor(save.state.setup);
    this.state = save.state;
    this.commands = save.log.commands;
    this.aiRejectedCitySites = save.log.aiRejectedCitySites ?? [];
    this.presentationQueue = [];
    this.lastRejected = null;
  }
  skipAnimations(): void { this.presentationQueue = []; }
  replayTo(sequence: number): void {
    this.state = replay(this.exportLog(), sequence, undefined, this.content);
    this.presentationQueue = [];
    this.lastRejected = null;
  }
  resumeFromReplay(): void {
    // A new command after a replay checkpoint starts a new local log branch.
    this.commands = this.commands.slice(0, this.state.commandSeq);
    this.aiRejectedCitySites = this.aiRejectedCitySites.filter(site => site.seq < this.state.commandSeq);
    this.endComputerTurns();
  }
}
