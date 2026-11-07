import type { GameSetup } from './model.ts';
/** Each state-shape change gets its own envelope; historic logs keep their original byte-for-byte envelope. */
export function gameVersions(setup: Pick<GameSetup, 'gameplayVersion'>) {
  return setup.gameplayVersion === 21 ? { schemaVersion: 16 as const, rulesVersion: 'opening-v21' as const }
    : setup.gameplayVersion === 20 ? { schemaVersion: 15 as const, rulesVersion: 'strength-v20' as const }
    : setup.gameplayVersion === 19 ? { schemaVersion: 14 as const, rulesVersion: 'classes-v19' as const }
    : setup.gameplayVersion === 18 ? { schemaVersion: 13 as const, rulesVersion: 'roles-v18' as const }
    : setup.gameplayVersion === 17 ? { schemaVersion: 12 as const, rulesVersion: 'cities-v17' as const }
    : setup.gameplayVersion === 16 ? { schemaVersion: 11 as const, rulesVersion: 'movement-v16' as const }
    : setup.gameplayVersion === 15 ? { schemaVersion: 10 as const, rulesVersion: 'legends-v15' as const }
    : setup.gameplayVersion === 14 ? { schemaVersion: 9 as const, rulesVersion: 'roster-v14' as const }
    : setup.gameplayVersion === 13 ? { schemaVersion: 8 as const, rulesVersion: 'promotions-v13' as const }
    : setup.gameplayVersion === 12 ? { schemaVersion: 7 as const, rulesVersion: 'eras-v12' as const }
    : setup.gameplayVersion === 11 ? { schemaVersion: 6 as const, rulesVersion: 'governments-v11' as const }
    : setup.gameplayVersion === 10 ? { schemaVersion: 5 as const, rulesVersion: 'districts-v10' as const }
    : { schemaVersion: 4 as const, rulesVersion: 'm5-v1' as const };
}
