/** Fixed v9–v11 contract smoke: four rotations × three personalities per seed, no balance tuning. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { leaderBalanceCases, simulateLeaderCase } from './leader-balance.ts';

const version = Number(process.argv[2]), destination = process.argv[3];
if (![9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23].includes(version) || !destination) throw new Error('Usage: node tools/district-smoke.ts <9|10|11|12|13|14|15|16|17|18|19|20|21|22|23> <output-directory>');
const config = { seeds: 4, seedStart: 31, expansionVersion: 1 as const, eraProgression: 'simple-v1' as const,
  gameplayVersion: version as 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23, roundLimit: 100 as const, width: 24, height: 16 };
mkdirSync(destination, { recursive: true });
writeFileSync(resolve(destination, 'config.json'), JSON.stringify(config, null, 2));
for (const match of leaderBalanceCases(config).filter(match => match.rotation < 4)) {
  const result = simulateLeaderCase(match);
  writeFileSync(resolve(destination, `${match.id}.json`), JSON.stringify(result, null, 2));
  console.log(match.id, result.status, result.round, result.outcomeKind);
  if (result.status !== 'completed') process.exitCode = 1;
}
