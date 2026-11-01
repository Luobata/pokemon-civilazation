import { deserializeSave, serializeSave } from '../app/save.ts';
import type { CommandLog } from '../app/session.ts';
import { rememberCityRejection } from '../ai/memory.ts';
import { planNext } from '../ai/plan.ts';
import { RULE_QUERIES } from '../ai/query.ts';
import { CONTENT } from '../content/units.ts';
import { createGame } from '../core/game.ts';
import type { Command, GameEvent, GameState } from '../core/model.ts';
import { step } from '../core/step.ts';
import { observe } from '../core/vision.ts';
import { parseAuditAction } from './commands.ts';

export const AUDIT_SNAPSHOT_KEY = 'pokemon-civilization:audit-snapshot';
export type AuditTrace = { command: Command; accepted: boolean; reason?: string; events: GameEvent[] };
const defaultSetup = {
  seed: 12345, width: 24, height: 16, roundLimit: 100 as const,
  players: [
    { id: 0, controller: 'human' as const, starterId: 'bulbasaur' as const, leaderId: 'oak' as const },
    { id: 1, controller: 'ai' as const, personality: 'expansion' as const, leaderId: 'lance' as const },
    { id: 2, controller: 'ai' as const, personality: 'expansion' as const, leaderId: 'jenny' as const },
    { id: 3, controller: 'ai' as const, personality: 'expansion' as const, leaderId: 'joy' as const },
  ],
};

/** Isolated engine driver. It never reads or writes the game's localStorage. */
export class AuditSandbox {
  private state: GameState;
  private log: CommandLog;
  private baseline: string;
  private history: { save: string; trace: AuditTrace[] }[] = [];
  trace: AuditTrace[] = [];

  constructor(text?: string) {
    if (text) {
      const save = deserializeSave(text);
      this.state = save.state;
      this.log = { ...save.log, commands: save.log.commands.slice(0, save.state.commandSeq),
        aiRejectedCitySites: (save.log.aiRejectedCitySites ?? []).filter(site => site.seq < save.state.commandSeq) };
    } else {
      this.state = createGame(defaultSetup);
      this.log = { version: 1, schemaVersion: 4, rulesVersion: 'm5-v1', contentVersion: CONTENT.version,
        setup: structuredClone(defaultSetup), commands: [], aiRejectedCitySites: [] };
    }
    this.baseline = this.save();
  }
  getState(): GameState { return structuredClone(this.state); }
  getLog(): CommandLog { return structuredClone(this.log); }
  save(): string { return serializeSave(this.state, this.log); }
  get canUndo(): boolean { return this.history.length > 0; }
  execute(action: Command['action'], preview = false) {
    const command: Command = { actorId: this.state.activePlayerId, expectedSeq: this.state.commandSeq, action: parseAuditAction(action) };
    const result = step(this.state, command);
    if (!preview) {
      this.history.push({ save: this.save(), trace: structuredClone(this.trace) });
      if (this.history.length > 30) this.history.shift();
      if (result.ok) {
        this.state = result.state;
        this.log.commands.push(structuredClone(command));
      }
      this.trace.unshift({ command, accepted: result.ok, ...(!result.ok ? { reason: result.reason } : {}),
        events: result.ok ? structuredClone(result.events) : [] });
      this.trace.splice(60);
    }
    return result;
  }
  aiStep() {
    const view = observe(this.state, this.state.activePlayerId);
    const command = planNext(view, RULE_QUERIES, this.log.aiRejectedCitySites ?? []);
    const result = this.execute(command.action);
    if (!result.ok) {
      this.log.aiRejectedCitySites ??= [];
      rememberCityRejection(this.log.aiRejectedCitySites, view, command, result.reason);
    }
    return result;
  }
  undo(): void {
    const previous = this.history.pop();
    if (!previous) return;
    const save = deserializeSave(previous.save);
    this.state = save.state; this.log = save.log; this.trace = previous.trace;
  }
  reset(): void {
    const save = deserializeSave(this.baseline);
    this.state = save.state; this.log = save.log; this.trace = []; this.history = [];
  }
}
