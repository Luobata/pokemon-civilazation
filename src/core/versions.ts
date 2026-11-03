import type { GameSetup } from './model.ts';
/** v10 is opt-in; historic logs keep their original byte-for-byte envelope. */
export function gameVersions(setup: Pick<GameSetup, 'gameplayVersion'>) {
  return setup.gameplayVersion === 10
    ? { schemaVersion: 5 as const, rulesVersion: 'districts-v10' as const }
    : { schemaVersion: 4 as const, rulesVersion: 'm5-v1' as const };
}
