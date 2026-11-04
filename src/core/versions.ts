import type { GameSetup } from './model.ts';
/** Each state-shape change gets its own envelope; historic logs keep their original byte-for-byte envelope. */
export function gameVersions(setup: Pick<GameSetup, 'gameplayVersion'>) {
  return setup.gameplayVersion === 16 ? { schemaVersion: 11 as const, rulesVersion: 'movement-v16' as const }
    : setup.gameplayVersion === 15 ? { schemaVersion: 10 as const, rulesVersion: 'legends-v15' as const }
    : setup.gameplayVersion === 14 ? { schemaVersion: 9 as const, rulesVersion: 'roster-v14' as const }
    : setup.gameplayVersion === 13 ? { schemaVersion: 8 as const, rulesVersion: 'promotions-v13' as const }
    : setup.gameplayVersion === 12 ? { schemaVersion: 7 as const, rulesVersion: 'eras-v12' as const }
    : setup.gameplayVersion === 11 ? { schemaVersion: 6 as const, rulesVersion: 'governments-v11' as const }
    : setup.gameplayVersion === 10 ? { schemaVersion: 5 as const, rulesVersion: 'districts-v10' as const }
    : { schemaVersion: 4 as const, rulesVersion: 'm5-v1' as const };
}
