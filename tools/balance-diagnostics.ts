import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONTENT, unitDefinition } from '../src/content/units.ts';
import { createGame } from '../src/core/game.ts';
import { maxCityHp } from '../src/core/city.ts';
import { step } from '../src/core/step.ts';
import { canonicalSerialize } from '../src/core/snapshot.ts';
import { PERSONALITIES } from './matches.ts';
import type { MatchResult } from './simulate.ts';
import { parsePatch } from './patch.ts';

export function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b), n = sorted.length;
  return { n, mean: n ? sorted.reduce((a, b) => a + b, 0) / n : null,
    median: n ? (sorted[Math.floor((n - 1) / 2)] + sorted[Math.ceil((n - 1) / 2)]) / 2 : null,
    min: n ? sorted[0] : null, max: n ? sorted[n - 1] : null };
}
export function diagnoseBalance(directory: string) {
  const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8'));
  const content = manifest.patch ? parsePatch(manifest.patch).content : CONTENT;
  const games = readdirSync(resolve(directory, 'games')).filter(name => name.endsWith('.json')).sort().map(name =>
    JSON.parse(readFileSync(resolve(directory, 'games', name), 'utf8')) as MatchResult);
  if (!games.length || games.some(game => game.defect || game.aborted || !game.outcome)) throw new Error('Diagnostics require completed, defect-free games');
  const seats = games.flatMap(game => {
    let state = createGame(game.setup, content);
    const rows = Object.values(state.players).map(player => ({ game: game.id, mode: game.mode, playerId: player.id, personality: player.personality,
      firstCombat3: game.telemetry.rounds.find(round => round.players.some(seat => seat.id === player.id && seat.combatUnits >= 3))?.round ?? null,
      firstCombat4: game.telemetry.rounds.find(round => round.players.some(seat => seat.id === player.id && seat.combatUnits >= 4))?.round ?? null,
      firstDeclaration: null as number | null, firstCityAttack: null as number | null, firstEnemyCapture: null as number | null,
      enemyCityAttacks: 0, neutralCityAttacks: 0, enemyCaptures: 0, ordinaryCaptures: 0, headquartersCaptures: 0, neutralCaptures: 0,
      cityCounterKnockdowns: 0, damage: [] as number[], counterDamage: [] as number[], maxHp: [] as number[], attacksPerCapture: [] as number[],
      settlersProduced: game.telemetry.activity[player.id].settlersProduced,
      finalCities: 0, finalPopulation: 0, finalTechs: 0, finalCombat: 0, finalRecovering: 0, finalUpkeep: 0,
    }));
    const attackRuns = new Map<string, number>();
    for (const command of game.commands) {
      const row = rows.find(row => row.playerId === command.actorId)!;
      const result = step(state, command, content);
      if (!result.ok) throw new Error(`${game.id} rejected during replay at ${state.commandSeq}: ${result.reason}`);
      if (command.action.type === 'DeclareWar') row.firstDeclaration ??= state.round;
      for (const { payload } of result.events) {
        if (payload.type !== 'BattleResolved' || payload.target.kind !== 'city') continue;
        const city = state.cities[payload.target.id], neutral = city.ownerId === null;
        const headquarters = !neutral && state.players[city.ownerId!].headquartersCityId === city.id;
        const key = `${command.actorId}:${city.id}`, attacks = (attackRuns.get(key) ?? 0) + 1; attackRuns.set(key, attacks);
        row.firstCityAttack ??= state.round;
        if (neutral) row.neutralCityAttacks++; else row.enemyCityAttacks++;
        row.damage.push(payload.damage); row.counterDamage.push(payload.counterDamage); row.maxHp.push(maxCityHp(city, content));
        row.cityCounterKnockdowns += payload.knockdowns?.filter(record => record.source.kind === 'city').length ?? 0;
        if (payload.capturedCity) {
          row.attacksPerCapture.push(attacks);
          if (neutral) row.neutralCaptures++;
          else {
            row.enemyCaptures++; row.firstEnemyCapture ??= state.round;
            if (headquarters) row.headquartersCaptures++; else row.ordinaryCaptures++;
          }
        }
      }
      // Any ownership change ends the old siege segment, including HQ elimination neutralizing other cities.
      for (const city of Object.values(state.cities)) if (result.state.cities[city.id].ownerId !== city.ownerId) {
        for (const player of rows) attackRuns.delete(`${player.playerId}:${city.id}`);
      }
      state = result.state;
    }
    if (canonicalSerialize(state.outcome) !== canonicalSerialize(game.outcome)) throw new Error(`${game.id} outcome mismatch on replay`);
    for (const row of rows) {
      const score = state.outcome!.ranking.find(score => score.playerId === row.playerId)!;
      const units = Object.values(state.units).filter(unit => unit.ownerId === row.playerId);
      row.finalCities = score.cities; row.finalPopulation = score.population; row.finalTechs = score.techs;
      row.finalCombat = units.filter(unit => unit.kind === 'pokemon' && unit.location === 'map').length;
      row.finalRecovering = units.filter(unit => unit.location === 'recovering').length;
      row.finalUpkeep = units.reduce((sum, unit) => sum + unitDefinition(unit, content).upkeep, 0);
    }
    return rows;
  });
  const groups = ['all', '1v1', '1v3'].map(mode => ({ mode, personalities: PERSONALITIES.map(personality => {
    const sample = seats.filter(seat => seat.personality === personality && (mode === 'all' || seat.mode === mode));
    const time = (key: 'firstCombat3' | 'firstCombat4' | 'firstDeclaration' | 'firstCityAttack' | 'firstEnemyCapture') => {
      const values = sample.flatMap(seat => seat[key] === null ? [] : [seat[key]]);
      return { ...distribution(values), never: sample.length - values.length };
    };
    const sums = ['enemyCityAttacks', 'neutralCityAttacks', 'enemyCaptures', 'ordinaryCaptures', 'headquartersCaptures', 'neutralCaptures', 'cityCounterKnockdowns', 'settlersProduced'] as const;
    const finals = ['finalCities', 'finalPopulation', 'finalTechs', 'finalCombat', 'finalRecovering', 'finalUpkeep'] as const;
    return { personality, seats: sample.length, firstCombat3: time('firstCombat3'), firstCombat4: time('firstCombat4'),
      firstDeclaration: time('firstDeclaration'), firstCityAttack: time('firstCityAttack'), firstEnemyCapture: time('firstEnemyCapture'),
      funnel: { noDeclaration: sample.filter(seat => seat.firstDeclaration === null).length,
        declarationNoCityAttack: sample.filter(seat => seat.firstDeclaration !== null && seat.firstCityAttack === null).length,
        cityAttackNoEnemyCapture: sample.filter(seat => seat.firstCityAttack !== null && seat.firstEnemyCapture === null).length },
      counts: Object.fromEntries(sums.map(key => [key, sample.reduce((sum, seat) => sum + seat[key], 0)])),
      damage: distribution(sample.flatMap(seat => seat.damage)), counterDamage: distribution(sample.flatMap(seat => seat.counterDamage)),
      cityMaxHp: distribution(sample.flatMap(seat => seat.maxHp)), attacksPerCapture: distribution(sample.flatMap(seat => seat.attacksPerCapture)),
      final: Object.fromEntries(finals.map(key => [key, distribution(sample.map(seat => seat[key]))])),
      settlersProduced: distribution(sample.map(seat => seat.settlersProduced)) };
  }) }));
  const four = games.filter(game => game.mode === '1v3');
  const fourWithHqCapture = four.filter(game => seats.some(seat => seat.game === game.id && seat.headquartersCaptures > 0));
  return { source: resolve(directory), patch: manifest.patch ?? null, patchSha256: manifest.patchSha256 ?? null,
    games: games.length, replayedCommands: games.reduce((sum, game) => sum + game.commands.length, 0),
    definitions: { firstCombat: 'First round-end telemetry with >=3/4 map Pokémon; never counts censored seats.',
      firstDeclaration: 'First accepted DeclareWar by this seat, not a war declared against it.',
      attacksPerCapture: 'Attacks by the capturing player against that city during its current ownership; gaps allowed, reset at any ownership change. Captured cities only, including neutral camps.',
      final: 'Actual replay terminal state, not the last RoundEnded snapshot; eliminated units removed. Upkeep includes recovering units.',
      settlersProduced: 'Completed settler production (including pending deployment), excluding the initial settler.' },
    fourPlayerConversion: { games: four.length, gamesWithHeadquartersCapture: fourWithHqCapture.length,
      conquestGames: four.filter(game => game.kind === 'conquest').length,
      headquartersCaptures: seats.filter(seat => seat.mode === '1v3').reduce((sum, seat) => sum + seat.headquartersCaptures, 0) },
    groups, seats };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4) throw new Error('Usage: node tools/balance-diagnostics.ts <run-directory> <output.json>');
  const result = diagnoseBalance(process.argv[2]);
  writeFileSync(process.argv[3], JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ games: result.games, replayedCommands: result.replayedCommands, fourPlayerConversion: result.fourPlayerConversion }));
}
