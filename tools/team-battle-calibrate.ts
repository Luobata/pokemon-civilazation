/**
 * Gameplay v26 offline calibration of the relay battles (docs/design/depth-v26.md §2.2, §13): random full-HP teams of the regional
 * Pokédex against the Elite Four (target ≈ 60% for six random stage-3 Pokémon), the guardians and the conference NPC teams, for a range
 * of the knobs. Pure: no game is played. Usage: node tools/team-battle-calibrate.ts [--teams 1000] [--seeds 31-38]
 */
import { contentFor } from '../src/content/units.ts';
import type { Content } from '../src/content/units.ts';
import { ELITE_FOUR } from '../src/content/gym-circuit.ts';
import { CIVILIZATION_CONTENT } from '../src/content/civilization-systems.ts';
import type { SpeciesId } from '../src/content/species.ts';
import { stableSeed } from '../src/content/stable-seed.ts';
import { eliteFourTeam } from '../src/core/gym-circuit.ts';
import { championshipNpcEntrants, guardianFighter } from '../src/core/civilization-systems.ts';
import { fighterFromCombatant, resolveTeamBattle, runGauntlet, SPEED_TIERS } from '../src/core/team-battle.ts';
import type { RelayFighter } from '../src/core/team-battle.ts';
import type { GameSetup } from '../src/core/model.ts';

const args = process.argv.slice(2), flag = (name: string, fallback: string) => args[args.indexOf(name) + 1] && args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const teams = Number(flag('--teams', '1000')), [lowSeed, highSeed] = flag('--seeds', '31-38').split('-').map(Number);
const setup = (seed: number): GameSetup => ({ seed, width: 40, height: 26, roundLimit: 200, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion: 26,
  players: [{ id: 0, controller: 'ai' }, { id: 1, controller: 'ai' }, { id: 2, controller: 'ai' }, { id: 3, controller: 'ai' }] });
const withTuning = (content: Content, patch: Partial<NonNullable<Content['depth26']>>): Content => ({ ...content, depth26: { ...content.depth26!, ...patch } });
const fighterOf = (content: Content, speciesId: SpeciesId, id: string): RelayFighter => {
  const species = content.species[speciesId];
  return { id, unitId: null, speciesId, typeIds: [species.typeId, ...(species.secondaryTypeId ? [species.secondaryTypeId] : [])], hp: species.maxHp, maxHp: species.maxHp,
    attack: species.attack, defense: species.defense, power: species.power, speed: SPEED_TIERS[species.role], veteran: 0 };
};
const randomTeam = (content: Content, pool: readonly SpeciesId[], size: number, tag: string) =>
  Array.from({ length: size }, (_, index) => fighterOf(content, pool[stableSeed(tag, index) % pool.length], `t-${index}`));
const pct = (wins: number, total: number) => `${(wins * 100 / Math.max(1, total)).toFixed(1)}%`;
const seeds = Array.from({ length: highSeed - lowSeed + 1 }, (_, index) => lowSeed + index);
const lines: string[] = [`# v26 relay calibration (${teams} random full-HP teams per map seed, seeds ${lowSeed}-${highSeed})`, ''];

lines.push('## Elite Four (six random stage-3 regional Pokémon, random order)', '', '| eliteFourPowerPercent | win |', '| --- | --- |');
for (const percent of [55, 60, 62, 63, 64, 65, 70, 80]) {
  let wins = 0, total = 0;
  for (const seed of seeds) {
    const content = withTuning(contentFor(setup(seed)), { eliteFourPowerPercent: percent });
    const pool = content.regionalDex!.speciesIds.filter(id => content.species[id].stage === 3);
    const opponents = ELITE_FOUR.map((_, stage) => eliteFourTeam(stage, seed, content).map(member => fighterFromCombatant(member, content)));
    for (let team = 0; team < teams; team++) {
      const home = randomTeam(content, pool, 6, `e4-${seed}-${team}`);
      if (runGauntlet(home, opponents, opponents.map((_, stage) => stableSeed('cal', seed, team, stage)), 'grassland').reached === ELITE_FOUR.length) wins++;
      total++;
    }
  }
  lines.push(`| ${percent} | ${pct(wins, total)} |`);
}

lines.push('', '## Guardians (three random stage-2/3 regional Pokémon at full HP)', '', '| guardian | HP | win |', '| --- | --- | --- |');
for (const definition of CIVILIZATION_CONTENT.sanctuaries.definitions) {
  let wins = 0, total = 0, hp = 0;
  for (const seed of seeds) {
    const content = contentFor(setup(seed)), pool = content.regionalDex!.speciesIds.filter(id => content.species[id].stage >= 2);
    const guardian = guardianFighter({ id: definition.id, guardianSpeciesId: definition.guardianSpeciesId, challengePower: definition.challengePower }, content);
    hp = guardian.maxHp;
    for (let team = 0; team < teams; team++) {
      if (resolveTeamBattle(randomTeam(content, pool, 3, `g-${seed}-${team}`), [{ ...guardian }], stableSeed('cal-g', seed, team), 'grassland').winnerSide === 'home') wins++;
      total++;
    }
  }
  lines.push(`| ${definition.guardianName}（${definition.guardianSpeciesId}, ${definition.challengePower}） | ${hp} | ${pct(wins, total)} |`);
}

lines.push('', '## Conference (six random stage-3 regional Pokémon, one match against each NPC team)', '', '| npcBasePower | season 1 | season 4 | season 8 |', '| --- | --- | --- | --- |');
for (const base of [700, 850, 1000, 1150, 1300]) {
  const cells = [1, 4, 8].map(season => {
    let wins = 0, total = 0;
    for (const seed of seeds) {
      const content = withTuning(contentFor(setup(seed)), { npcBasePower: base });
      const pool = content.regionalDex!.speciesIds.filter(id => content.species[id].stage === 3);
      const npcs = championshipNpcEntrants(seed, season, content);
      for (let team = 0; team < Math.ceil(teams / 4); team++) for (const npc of npcs) {
        if (resolveTeamBattle(randomTeam(content, pool, 6, `c-${seed}-${team}`), npc.roster.map(member => fighterFromCombatant(member, content)), stableSeed('cal-c', seed, team, npc.entrantId), 'grassland').winnerSide === 'home') wins++;
        total++;
      }
    }
    return pct(wins, total);
  });
  lines.push(`| ${base} | ${cells.join(' | ')} |`);
}
console.log(lines.join('\n'));
