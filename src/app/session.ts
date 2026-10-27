import { isMapUnit } from '../core/model.ts';
import { deserializeSave, serializeSave } from './save.ts';
import { CONTENT } from '../content/units.ts';
import type { Content } from '../content/units.ts';
import { createGame } from '../core/game.ts';
import type { Command, GameSetup, GameState, PlayerView, StepResult, VisibleEvent } from '../core/model.ts';
import { observe, projectEvents } from '../core/vision.ts';
import { step } from '../core/step.ts';
import { canonicalSerialize } from '../core/snapshot.ts';

export type CommandLog = { version: 1; schemaVersion: 3; rulesVersion: 'm3-v1'; contentVersion: string; setup: GameSetup; commands: Command[] };

export function replay(log: CommandLog, through = log.commands.length, checkpoint?: GameState, content: Content = CONTENT): GameState {
  if (log.version !== 1 || log.schemaVersion !== 3 || log.rulesVersion !== 'm3-v1' || log.contentVersion !== content.version
    || !Number.isInteger(through) || through < 0 || through > log.commands.length) throw new Error('Unsupported log or replay sequence.');
  let state = checkpoint ? JSON.parse(JSON.stringify(checkpoint)) as GameState : createGame(log.setup, content);
  if (state.commandSeq > through || canonicalSerialize(state.setup) !== canonicalSerialize(log.setup)
    || state.contentVersion !== log.contentVersion || state.rulesVersion !== 'm3-v1') throw new Error('Checkpoint does not match this log.');
  for (const command of log.commands.slice(state.commandSeq, through)) {
    const result = step(state, command, content);
    if (!result.ok) throw new Error(`Replay rejected at ${state.commandSeq}: ${result.reason}`);
    state = result.state;
  }
  return state;
}

export class GameSession {
  private state: GameState;
  private commands: Command[] = [];
  get playerId(): number { return this.state.setup.players.find(player => player.controller === 'human')!.id; }
  presentationQueue: VisibleEvent[] = [];
  lastRejected: { command: Command; reason: string } | null = null;

  constructor(setup: GameSetup, private readonly content: Content = CONTENT) {
    this.state = createGame(setup, content);
    this.endComputerTurns();
  }
  getState(): GameState { return JSON.parse(JSON.stringify(this.state)) as GameState; }
  getView(): PlayerView { return observe(this.state, this.playerId, this.content); }
  getDebugView(): PlayerView {
    const view = this.getView();
    const state = this.getState();
    return { ...view, map: state.map, visibleTileIds: state.map.tiles.map((_, i) => i),
      units: Object.values(state.units).filter(isMapUnit), cities: Object.values(state.cities) };
  }
  exportLog(): CommandLog {
    return { version: 1, schemaVersion: 3, rulesVersion: 'm3-v1', contentVersion: this.content.version, setup: this.getState().setup,
      commands: JSON.parse(JSON.stringify(this.commands)) as Command[] };
  }
  issue(action: Command['action']): StepResult {
    return this.submit({ actorId: this.playerId, expectedSeq: this.state.commandSeq, action });
  }
  submit(command: Command): StepResult {
    const result = this.apply(command);
    if (result.ok) this.endComputerTurns();
    return result.ok ? { ...result, state: JSON.parse(JSON.stringify(result.state)) as GameState } : result;
  }
  private apply(command: Command): StepResult {
    const before = this.state;
    const result = step(before, command, this.content);
    if (!result.ok) this.lastRejected = { command: JSON.parse(JSON.stringify(command)) as Command, reason: result.reason };
    else {
      this.state = result.state;
      this.commands = this.commands.slice(0, before.commandSeq);
      this.commands.push(JSON.parse(JSON.stringify(command)) as Command);
      this.presentationQueue.push(...projectEvents(before, this.state, result.events, this.playerId, this.content));
    }
    return result;
  }
  private endComputerTurns(): void {
    // M1 temporary strategy: nonhuman turns only EndTurn. M4 replaces this
    // application policy with the planner; the core never imports AI/app.
    while (this.state.players[this.state.activePlayerId].controller === 'ai') {
      this.apply({ actorId: this.state.activePlayerId, expectedSeq: this.state.commandSeq, action: { type: 'EndTurn' } });
    }
  }
  save(): string { return serializeSave(this.getState(), this.exportLog()); }
  load(text: string): void {
    const save = deserializeSave(text, this.content);
    this.state = save.state;
    this.commands = save.log.commands;
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
    this.endComputerTurns();
  }
}
