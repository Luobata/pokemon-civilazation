import { createGame } from '../core/game.ts';
import { observe } from '../core/vision.ts';
import { step } from '../core/step.ts';
import { cloneContent, importEditorContent, validateEditorContent } from './content.ts';
import type { Content } from '../content/units.ts';
import type { Command, GameSetup, GameState, PlayerView, StepResult } from '../core/model.ts';

export type EditorSimulationResult = {
  ok: boolean;
  reason?: string;
  view: PlayerView;
  seq: number;
};

export class EditorSandbox {
  private state: GameState;
  private readonly content: Content;

  constructor(content: Content = cloneContent(), setup?: GameSetup) {
    this.content = validateEditorContent(content);
    this.state = createGame(setup ?? defaultEditorSetup(), this.content);
  }

  static fromJson(text: string): EditorSandbox {
    return new EditorSandbox(importEditorContent(text));
  }

  getView(playerId = 0): PlayerView {
    return observe(this.state, playerId, this.content);
  }

  issue(action: Command['action'], playerId = this.state.activePlayerId): EditorSimulationResult {
    const result: StepResult = step(this.state, { actorId: playerId, expectedSeq: this.state.commandSeq, action }, this.content);
    const before = this.state;
    if (result.ok) this.state = result.state;
    return { ok: result.ok, ...(result.ok ? {} : { reason: result.reason }), view: observe(result.ok ? this.state : before, playerId, this.content), seq: this.state.commandSeq };
  }

  reset(setup?: GameSetup): void {
    this.state = createGame(setup ?? defaultEditorSetup(), this.content);
  }

  get seq(): number { return this.state.commandSeq; }
}

export function defaultEditorSetup(): GameSetup {
  return {
    seed: 12345,
    width: 24,
    height: 16,
    roundLimit: 100,
    expansionVersion: 1,
    multiplayer: true,
    players: [
      { id: 0, controller: 'ai', personality: 'conservative' },
      { id: 1, controller: 'ai', personality: 'conservative' },
    ],
  };
}

export function runIsolatedSimulation(content: Content, actions: Command['action'][] = [{ type: 'EndTurn' }, { type: 'EndTurn' }], setup?: GameSetup): EditorSimulationResult[] {
  const sandbox = new EditorSandbox(content, setup);
  return actions.map(action => sandbox.issue(action));
}
