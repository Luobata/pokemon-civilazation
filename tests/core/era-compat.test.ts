import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { createGame } from '../../src/core/game.ts';
import { step } from '../../src/core/step.ts';
import { canonicalSerialize } from '../../src/core/snapshot.ts';
import type { Command, GameSetup, GameState } from '../../src/core/model.ts';

test('era games recorded before gameplay packs replay to the identical final state', () => {
  const log = JSON.parse(readFileSync(new URL('./fixtures/era-c8a830c-log.json', import.meta.url), 'utf8')) as { setup: GameSetup; commands: Command[]; finalSha256: string };
  expect(log.setup).not.toHaveProperty('gameplayVersion');
  expect(log.commands.filter(command => command.action.type === 'Attack' && command.action.target.kind === 'city').length).toBeGreaterThan(10);
  let state: GameState = createGame(log.setup);
  for (const command of log.commands) {
    const result = step(state, command);
    expect(result.ok).toBe(true);
    if (result.ok) state = result.state;
  }
  expect(createHash('sha256').update(canonicalSerialize(state)).digest('hex')).toBe(log.finalSha256);
});
