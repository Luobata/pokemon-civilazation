import { gameVersions } from '../core/versions.ts';
import { cityDistrictEffects, districtProjects } from '../core/districts.ts';
import { slotCounts } from '../core/policies.ts';
import { FLANK_MAX, FLANK_PER_UNIT, usesTactics } from '../core/tactics.ts';
import { RULE_QUERIES } from '../ai/query.ts';
import { knownCombatCount, planNext } from '../ai/plan.ts';
import { unitDefinition, contentFor } from '../content/units.ts';
import { LEADERS } from '../content/leaders.ts';
import { cityYield, growthThreshold, maxCityHp, workRadius } from '../core/city.ts';
import { relationFor } from '../core/diplomacy.ts';
import { isMapUnit } from '../core/model.ts';
import type { GameState, MapUnit, UnitState } from '../core/model.ts';
import { reachablePaths } from '../core/movement.ts';
import { previewCapture } from '../core/preview.ts';
import { canonicalSerialize, stateDigest } from '../core/snapshot.ts';
import { maxUnitHp } from '../core/unit.ts';
import { scorePlayer } from '../core/victory.ts';
import { observe, visibleTiles } from '../core/vision.ts';
import { AUDIT_SYSTEMS, AUDIT_SYSTEM_BY_ID } from './catalog.ts';
import type { AuditSystem } from './catalog.ts';

export type AuditMetric = { label: string; value: string | number };
export type AuditSystemInspection = { metrics: AuditMetric[]; data: unknown };

const contentOf = (state: GameState) => contentFor(state.setup);
const metric = (label: string, value: string | number): AuditMetric => ({ label, value });
const tally = <T>(values: readonly T[]): Record<string, number> => values.reduce<Record<string, number>>((result, value) => {
  const key = String(value);
  return { ...result, [key]: (result[key] ?? 0) + 1 };
}, {});
const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);
const percentage = (part: number, total: number): number => total === 0 ? 0 : Math.round(part * 100 / total);
const statusLabel = (status: AuditSystem['status']): string => status === 'implemented' ? '已实现' : status === 'partial' ? '部分实现' : '待实现';
type PokemonMapUnit = Extract<MapUnit, { kind: 'pokemon' }>;
const pokemonOnMap = (units: readonly UnitState[]): PokemonMapUnit[] =>
  units.filter((unit): unit is PokemonMapUnit => isMapUnit(unit) && unit.kind === 'pokemon');
const authorityFieldCount = (fields: readonly string[]): number => fields.length;

const PLANNED_AUTHORITY_GAPS: Record<string, string[]> = {
  'leaders-active': ['leaderActiveAbilities', 'leaderCooldowns', 'uniqueUnits', 'uniqueBuildings', 'leaderAiPriorities'],
  'x11-content-editor': ['contentEditorState', 'resourcePackages', 'editorDrafts', 'contentMigration'],
  's18-nests': ['nests', 'nestSpawnSchedule', 'hostileWildOwner', 'nestClearance'],
  's19-overlords': ['overlordTerritories', 'offerings', 'bondLevels', 'overlordBonuses'],
  's20-berries': ['tileResources', 'berryInventory', 'satisfaction', 'resourceHarvestHistory'],
  's21-evolution-stones': ['stoneResources', 'stoneInventory', 'evolutionStoneCosts'],
  's22-pokedex': ['pokedexObservations', 'pokedexForms', 'pokedexVictoryProgress'],
  's23-faith': ['faithPoints', 'tablets', 'faithBuildings', 'greatPersonPools'],
  's24-sanctuaries': ['sanctuaries', 'sanctuaryGuardians', 'sanctuaryHolders'],
  's25-trainers': ['greatPersonUnits', 'trainerCategories', 'trainerEffects'],
  's26-origin-victory': ['tabletOwnership', 'tabletDelivery', 'originVictoryState'],
  's27-championship': ['championships', 'teams', 'matches', 'championshipVictoryState'],
  's28-deep-diplomacy': ['alliances', 'tradeAgreements', 'trustLevels', 'extendedDiplomacyEvents'],
  's29-multiplayer': ['serverSession', 'authenticatedActors', 'connectionEpochs', 'serverAcknowledgements'],
  's30-type-expansion': ['secondaryTypeIds', 'specialForms', 'expandedTypeChart'],
};

const plannedEvidence = (systemId: string, state: GameState): Record<string, unknown> => {
  const pokemon = pokemonOnMap(Object.values(state.units));
  const firstCity = Object.values(state.cities)[0];
  switch (systemId) {
    case 'x11-content-editor': return { currentContentKeys: Object.keys(contentOf(state)), contentVersion: contentOf(state).version };
    case 's18-nests': return { unitAuthorityFields: Object.keys(state.units), wildUnitCount: pokemon.filter(unit => unit.ownerId === null).length };
    case 's19-overlords': return { cityAuthorityFields: Object.keys(firstCity ?? {}), neutralCityCount: Object.values(state.cities).filter(city => city.ownerId === null).length };
    case 's20-berries': return { mapAuthorityFields: Object.keys(state.map), tileBiomeCount: state.map.tiles.length, berryBuildingPresent: Object.values(state.cities).some(city => city.buildingIds.includes('pasture')) };
    case 's21-evolution-stones': return { playerAuthorityFields: Object.keys(state.players[state.activePlayerId]), currentEvolutionRule: 'XP + gold + optional training tech' };
    case 's22-pokedex': return { registeredSpeciesCountByPlayer: Object.values(state.players).map(player => ({ playerId: player.id, count: player.registeredSpeciesIds.length })) };
    case 's23-faith': return { playerAuthorityFields: Object.keys(state.players[state.activePlayerId]), cityAuthorityFields: Object.keys(firstCity ?? {}) };
    case 's24-sanctuaries': return { cityAuthorityFields: Object.keys(firstCity ?? {}), mapAuthorityFields: Object.keys(state.map) };
    case 's25-trainers': return { unitAuthorityFields: Object.keys(state.units), leaderDefinitionCount: Object.keys(LEADERS).length };
    case 's26-origin-victory': return { outcomeKinds: ['conquest', 'score', 'playerDefeat'], currentOutcome: state.outcome };
    case 's27-championship': return { unitAuthorityFields: Object.keys(state.units), outcomeKinds: ['conquest', 'score', 'playerDefeat'] };
    case 's28-deep-diplomacy': return { diplomacyAuthorityFields: Object.keys(state.diplomacy[0] ?? {}), relationCount: state.diplomacy.length };
    case 's29-multiplayer': return { setupAuthorityFields: Object.keys(state.setup), turnOrder: state.turnOrder, authoritativeSession: 'local only; outside GameState' };
    case 's30-type-expansion': return { contentTypeIds: Object.values(contentOf(state).species).map(species => species.typeId), speciesTypeShape: 'single typeId' };
    default: return {};
  }
};

const baseMetrics = (system: AuditSystem, state: GameState): AuditMetric[] => [
  metric('系统状态', statusLabel(system.status)),
  metric('当前轮次', state.round),
  metric('命令序号', state.commandSeq),
];

function inspectMap(state: GameState): AuditSystemInspection {
  const biomeCounts = tally(state.map.tiles);
  return {
    metrics: [
      ...baseMetrics(AUDIT_SYSTEM_BY_ID.get('s1-map')!, state),
      metric('地图尺寸', `${state.map.width} × ${state.map.height}`),
      metric('格子总数', state.map.tiles.length),
      metric('群系种类', Object.keys(biomeCounts).length),
      metric('生成算法', 'generationVersion 1（权威状态保存结果，不回放生成过程）'),
    ],
    data: { width: state.map.width, height: state.map.height, tileCount: state.map.tiles.length,
      biomeCounts, seed: state.setup.seed, rng: state.rng },
  };
}

function inspectVision(state: GameState): AuditSystemInspection {
  const rows = Object.values(state.players).map(player => {
    const visible = visibleTiles(state, player.id);
    const knowledge = state.knowledge[player.id];
    return { playerId: player.id, visibleCount: visible.size, exploredCount: knowledge.exploredTileIds.length,
      rememberedTileCount: Object.keys(knowledge.rememberedTiles).length,
      rememberedUnitCount: Object.keys(knowledge.lastKnownUnits).length,
      rememberedCityCount: Object.keys(knowledge.lastKnownCities).length };
  });
  return {
    metrics: [
      ...baseMetrics(AUDIT_SYSTEM_BY_ID.get('s2-vision')!, state),
      metric('玩家数', rows.length),
      metric('已探索格子', sum(rows.map(row => row.exploredCount))),
      metric('当前可见格子', sum(rows.map(row => row.visibleCount))),
      metric('记忆单位', sum(rows.map(row => row.rememberedUnitCount))),
    ],
    data: { players: rows },
  };
}

function inspectCities(state: GameState): AuditSystemInspection {
  const cities = Object.values(state.cities);
  const activePlayers = Object.values(state.players).filter(player => !player.eliminated);
  const validHeadquarters = activePlayers.filter(player => {
    const city = state.cities[player.headquartersCityId];
    return city !== undefined && city.ownerId === player.id;
  });
  return {
    metrics: [
      ...baseMetrics(AUDIT_SYSTEM_BY_ID.get('s3-cities')!, state),
      metric('城市总数', cities.length),
      metric('有主城市', cities.filter(city => city.ownerId !== null).length),
      metric('中立城市', cities.filter(city => city.ownerId === null).length),
      metric('大本营有效', `${validHeadquarters.length} / ${activePlayers.length}`),
      metric('本轮占领', cities.filter(city => city.capturedAtRound === state.round).length),
    ],
    data: { total: cities.length, neutralCount: cities.filter(city => city.ownerId === null).length,
      capturedThisRound: cities.filter(city => city.capturedAtRound === state.round).map(city => city.id),
      activeHeadquarters: activePlayers.map(player => ({ playerId: player.id, cityId: player.headquartersCityId,
        valid: state.cities[player.headquartersCityId]?.ownerId === player.id })),
      cities: cities.map(city => ({ id: city.id, ownerId: city.ownerId, position: city.position,
        hp: city.hp, maxHp: maxCityHp(city), headquartersOf: city.headquartersOf ?? null, capturedAtRound: city.capturedAtRound })) },
  };
}

function inspectPopulation(state: GameState): AuditSystemInspection {
  const cities = Object.values(state.cities).filter(city => city.ownerId !== null);
  const rows = cities.map(city => ({ cityId: city.id, ownerId: city.ownerId, population: city.population,
    workers: city.workedTileIds.length, observers: Math.max(0, city.population - city.workedTileIds.length),
    locked: city.lockedTileIds.length, food: city.food, growthThreshold: growthThreshold(city),
    workRadius: workRadius(city) }));
  return {
    metrics: [
      ...baseMetrics(AUDIT_SYSTEM_BY_ID.get('s4-population')!, state),
      metric('总人口', sum(rows.map(row => row.population))),
      metric('工作人口', sum(rows.map(row => row.workers))),
      metric('观测者', sum(rows.map(row => row.observers))),
      metric('锁定地块', sum(rows.map(row => row.locked))),
      metric('达到增长阈值', rows.filter(row => row.food >= row.growthThreshold).length),
    ],
    data: { cities: rows },
  };
}

function inspectEconomy(state: GameState): AuditSystemInspection {
  const cities = Object.values(state.cities).filter(city => city.ownerId !== null);
  const yields = cities.map(city => cityYield(state, city));
  const upkeep = sum(Object.values(state.units).filter(unit => unit.ownerId !== null).map(unit => unitDefinition(unit, contentOf(state)).upkeep));
  const playerRows = Object.values(state.players).map(player => {
    const owned = cities.filter(city => city.ownerId === player.id);
    const income = sum(owned.map(city => cityYield(state, city).gold));
    const playerUpkeep = sum(Object.values(state.units).filter(unit => unit.ownerId === player.id).map(unit => unitDefinition(unit, contentOf(state)).upkeep));
    return { playerId: player.id, gold: player.gold, income, upkeep: playerUpkeep,
      netGold: income - playerUpkeep, deficitRisk: player.gold + income - playerUpkeep < 0 };
  });
  const totals = { food: sum(yields.map(item => item.food)), production: sum(yields.map(item => item.production)),
    gold: sum(yields.map(item => item.gold)), research: sum(yields.map(item => item.research)) };
  return {
    metrics: [
      ...baseMetrics(AUDIT_SYSTEM_BY_ID.get('s5-economy')!, state),
      metric('食物收入', totals.food), metric('生产收入', totals.production),
      metric('金币收入', totals.gold), metric('科研收入', totals.research),
      metric('单位维护', upkeep), metric('下轮赤字风险', playerRows.filter(row => row.deficitRisk).length),
    ],
    data: { totals, upkeep, players: playerRows,
      cityYields: cities.map((city, index) => ({ cityId: city.id, ownerId: city.ownerId, ...yields[index] })) },
  };
}

function inspectBuildings(state: GameState): AuditSystemInspection {
  const cities = Object.values(state.cities);
  const buildingIds = Object.keys(contentOf(state).buildings);
  const counts = Object.fromEntries(buildingIds.map(id => [id, sum(cities.map(city => city.buildingIds.filter(value => value === id).length))]));
  return {
    metrics: [
      ...baseMetrics(AUDIT_SYSTEM_BY_ID.get('s6-buildings')!, state),
      metric('建筑实例', sum(Object.values(counts))),
      metric('生产队列项', sum(cities.map(city => city.queue.length))),
      metric('待部署单位', sum(cities.map(city => city.pendingDeployments.length))),
      metric('建筑 HP 加成', sum(cities.map(city => maxCityHp(city) - contentOf(state).balance.city.baseHp))),
    ],
    data: { counts, queueCount: sum(cities.map(city => city.queue.length)),
      pendingDeployments: sum(cities.map(city => city.pendingDeployments.length)),
      cities: cities.map(city => ({ id: city.id, ownerId: city.ownerId, buildingIds: city.buildingIds,
        queue: city.queue, pendingDeployments: city.pendingDeployments, hp: city.hp, maxHp: maxCityHp(city) })) },
  };
}

function inspectResearch(state: GameState): AuditSystemInspection {
  const players = Object.values(state.players);
  const rows = players.map(player => ({ playerId: player.id, unlockedIds: player.research.unlockedIds,
    selectedTechId: player.research.techId, reserve: player.research.reserve,
    progressEntries: Object.entries(player.research.progressByTech).filter(([, value]) => value > 0)
      .map(([techId, value]) => ({ techId, value })) }));
  return {
    metrics: [
      ...baseMetrics(AUDIT_SYSTEM_BY_ID.get('s7-research')!, state),
      metric('科技定义', Object.keys(contentOf(state).techs).length),
      metric('已解锁记录', sum(players.map(player => player.research.unlockedIds.length))),
      metric('当前课题', players.filter(player => player.research.techId !== null).length),
      metric('科研储备', sum(players.map(player => player.research.reserve))),
      metric('有进度课题', sum(rows.map(row => row.progressEntries.length))),
    ],
    data: { players: rows },
  };
}

function inspectSpecies(state: GameState): AuditSystemInspection {
  const mapPokemon = pokemonOnMap(Object.values(state.units));
  const byOwner = tally(mapPokemon.map(unit => unit.ownerId === null ? 'wild' : `player-${unit.ownerId}`));
  const registered = new Set(Object.values(state.players).flatMap(player => player.registeredSpeciesIds));
  return {
    metrics: [
      ...baseMetrics(AUDIT_SYSTEM_BY_ID.get('s8-species')!, state),
      metric('内容物种', Object.keys(contentOf(state).species).length),
      metric('已登记并集', registered.size),
      metric('地图宝可梦', mapPokemon.length),
      metric('地图物种', new Set(mapPokemon.map(unit => unit.speciesId)).size),
    ],
    data: { contentSpeciesCount: Object.keys(contentOf(state).species).length, registeredUnion: [...registered].sort(),
      registeredByPlayer: Object.values(state.players).map(player => ({ playerId: player.id, speciesIds: player.registeredSpeciesIds })),
      mapPokemonByOwner: byOwner, mapPokemonBySpecies: tally(mapPokemon.map(unit => unit.speciesId)) },
  };
}

function inspectWild(state: GameState): AuditSystemInspection {
  const wild = pokemonOnMap(Object.values(state.units)).filter(unit => unit.ownerId === null);
  const regionColumns = Math.ceil(state.map.width / 8);
  const regionCount = regionColumns * Math.ceil(state.map.height / 8);
  const regionOf = (index: number) => Math.floor(Math.floor(index / state.map.width) / 8) * regionColumns
    + Math.floor(index % state.map.width / 8);
  const regionCounts = tally(wild.map(unit => regionOf(unit.position.q + Math.floor(unit.position.r / 2) * state.map.width)));
  return {
    metrics: [
      ...baseMetrics(AUDIT_SYSTEM_BY_ID.get('s9-wild')!, state),
      metric('野生单位', wild.length),
      metric('区域上限', `${regionCount} × 2`),
      metric('全图上限', regionCount * 2),
      metric('激怒单位', wild.filter(unit => unit.enraged).length),
      metric('游荡物种', wild.filter(unit => unit.kind === 'pokemon' && ['rattata', 'meowth', 'pidgey', 'pikachu', 'magikarp', 'dratini'].includes(unit.speciesId)).length),
    ],
    data: { regionColumns, regionCount, regionCounts, globalCap: regionCount * 2,
      bySpecies: tally(wild.map(unit => unit.speciesId)),
      enragedUnitIds: wild.filter(unit => unit.enraged).map(unit => unit.id),
      limitation: '刷新尝试和抽样历史是过程事件，不保存在 GameState。' },
  };
}

function inspectCapture(state: GameState): AuditSystemInspection {
  const actorId = state.activePlayerId;
  const view = observe(state, actorId);
  const actors = view.units.filter(unit => unit.ownerId === actorId && unit.kind === 'pokemon' && unit.actionLeft === 1);
  const targets = view.units.filter(unit => unit.ownerId === null && unit.kind === 'pokemon');
  const pairs = actors.flatMap(actor => targets.flatMap(target => (['pokeBall', 'greatBall'] as const).flatMap(ballId => {
    const preview = previewCapture(view, actor.id, target.id, ballId);
    return preview.ok ? [{ actorId: actor.id, targetId: target.id, ballId, probability: preview.probability }] : [];
  })));
  const players = Object.values(state.players).map(player => ({ playerId: player.id,
    pokeBall: player.ballInventory.pokeBall, greatBall: player.ballInventory.greatBall,
    domestication: player.research.unlockedIds.includes('domestication') }));
  return {
    metrics: [
      ...baseMetrics(AUDIT_SYSTEM_BY_ID.get('s10-capture')!, state),
      metric('精灵球总数', sum(players.map(player => player.pokeBall + player.greatBall))),
      metric('已解锁驯化', players.filter(player => player.domestication).length),
      metric('当前行动方候选', pairs.length),
    ],
    data: { activePlayerId: actorId, players, validPairsForActivePlayer: pairs,
      limitation: '历史捕捉尝试和成功次数不是 GameState 字段，不能从当前状态伪造。' },
  };
}

function inspectEvolution(state: GameState): AuditSystemInspection {
  const candidates = pokemonOnMap(Object.values(state.units))
    .filter(unit => {
      const owner = unit.ownerId === null ? undefined : state.players[unit.ownerId];
      if (!owner || unit.ownerId !== state.activePlayerId || unit.actionLeft !== 1 || state.outcome) return false;
      const evolution = contentOf(state).species[unit.speciesId].evolution;
      return evolution !== null && unit.xp >= evolution.xp && owner.gold >= evolution.gold
        && (!evolution.requiresTraining || owner.research.unlockedIds.includes('training'));
    });
  const nodes = Object.entries(contentOf(state).species).filter(([, species]) => species.evolution !== null);
  const blockedByGold = pokemonOnMap(Object.values(state.units))
    .filter(unit => {
      const owner = unit.ownerId === null ? undefined : state.players[unit.ownerId];
      const evolution = owner === undefined ? null : contentOf(state).species[unit.speciesId].evolution;
      return owner !== undefined && evolution !== null && unit.xp >= evolution.xp && owner.gold < evolution.gold;
    });
  return {
    metrics: [
      ...baseMetrics(AUDIT_SYSTEM_BY_ID.get('s11-evolution')!, state),
      metric('进化节点', nodes.length),
      metric('当前可进化', candidates.length),
      metric('XP 达标但金币不足', blockedByGold.length),
    ],
    data: { evolutionNodes: nodes.map(([id, species]) => ({ from: id, to: species.evolution?.speciesId,
      xp: species.evolution?.xp, gold: species.evolution?.gold, requiresTraining: species.evolution?.requiresTraining ?? false })),
      candidates: candidates.map(unit => ({ unitId: unit.id, ownerId: unit.ownerId, from: unit.speciesId,
        to: contentOf(state).species[unit.speciesId].evolution?.speciesId, xp: unit.xp })),
      blockedByGold: blockedByGold.map(unit => ({ unitId: unit.id, ownerId: unit.ownerId, goldNeeded: contentOf(state).species[unit.speciesId].evolution?.gold })) },
  };
}

function inspectMovement(state: GameState): AuditSystemInspection {
  const actorId = state.activePlayerId;
  const view = observe(state, actorId);
  const units = view.units.filter(unit => unit.ownerId === actorId);
  const rows = units.map(unit => ({ unitId: unit.id, kind: unit.kind, actionLeft: unit.actionLeft,
    reachableTiles: Object.keys(reachablePaths(view, unit.id)).length }));
  return {
    metrics: [
      ...baseMetrics(AUDIT_SYSTEM_BY_ID.get('s12-movement')!, state),
      metric('当前方地图单位', units.length),
      metric('有行动点单位', rows.filter(row => row.actionLeft === 1).length),
      metric('可达格子总数', sum(rows.map(row => row.reachableTiles))),
      metric('地形消耗定义', Object.keys(contentOf(state).moveCosts).length),
    ],
    data: { activePlayerId: actorId, units: rows, moveCosts: contentOf(state).moveCosts },
  };
}

function inspectCombat(state: GameState): AuditSystemInspection {
  const units = Object.values(state.units);
  const mapUnits = units.filter(isMapUnit);
  const recovering = units.filter(unit => unit.location === 'recovering');
  const totalMaxHp = sum(units.map(unit => maxUnitHp(unit, contentOf(state))));
  const currentHp = sum(units.map(unit => unit.hp));
  const cities = Object.values(state.cities);
  const cityMaxHp = sum(cities.map(city => maxCityHp(city)));
  return {
    metrics: [
      ...baseMetrics(AUDIT_SYSTEM_BY_ID.get('s13-combat')!, state),
      metric('地图单位', mapUnits.length),
      metric('休养单位', recovering.length),
      metric('单位 HP', `${currentHp} / ${totalMaxHp} (${percentage(currentHp, totalMaxHp)}%)`),
      metric('城市 HP', `${sum(cities.map(city => city.hp))} / ${cityMaxHp} (${percentage(sum(cities.map(city => city.hp)), cityMaxHp)}%)`),
      metric('激怒单位', mapUnits.filter(unit => unit.enraged).length),
      metric('累计击坠', sum(Object.values(state.players).map(player => player.knockdownCount))),
    ],
    data: { mapUnitCount: mapUnits.length, recoveringUnitCount: recovering.length,
      unitHpPercentage: percentage(currentHp, totalMaxHp), cityHpPercentage: percentage(sum(cities.map(city => city.hp)), cityMaxHp),
      knockdownCountByPlayer: Object.values(state.players).map(player => ({ playerId: player.id, count: player.knockdownCount })),
      recovering: recovering.map(unit => ({ unitId: unit.id, ownerId: unit.ownerId, cityId: unit.cityId, roundsLeft: unit.roundsLeft })),
      limitation: '战报与攻击历史在事件流/日志中，GameState 不保存历史列表。' },
  };
}

function inspectTypes(state: GameState): AuditSystemInspection {
  const pokemon = pokemonOnMap(Object.values(state.units));
  return {
    metrics: [
      ...baseMetrics(AUDIT_SYSTEM_BY_ID.get('s14-types')!, state),
      metric('内容属性', new Set(Object.values(contentOf(state).species).map(species => species.typeId)).size),
      metric('文明宝可梦', pokemon.filter(unit => unit.ownerId !== null).length),
      metric('野生宝可梦', pokemon.filter(unit => unit.ownerId === null).length),
    ],
    data: { contentTypes: tally(Object.values(contentOf(state).species).map(species => species.typeId)),
      civilizationTypes: tally(pokemon.filter(unit => unit.ownerId !== null).map(unit => contentOf(state).species[unit.speciesId].typeId)),
      wildTypes: tally(pokemon.filter(unit => unit.ownerId === null).map(unit => contentOf(state).species[unit.speciesId].typeId)),
      limitation: '当前状态没有对战属性命中事件，不能统计实际克制次数。' },
  };
}

function inspectVictory(state: GameState): AuditSystemInspection {
  const ranking = Object.keys(state.players).map(Number).map(id => scorePlayer(state, id))
    .sort((a, b) => b.total - a.total || b.cities - a.cities || b.population - a.population || b.techs - a.techs || b.knockdowns - a.knockdowns || a.playerId - b.playerId);
  return {
    metrics: [
      ...baseMetrics(AUDIT_SYSTEM_BY_ID.get('s15-victory')!, state),
      metric('存活文明', Object.values(state.players).filter(player => !player.eliminated).length),
      metric('淘汰文明', Object.values(state.players).filter(player => player.eliminated).length),
      metric('当前结局', state.outcome?.kind ?? '进行中'),
      metric('轮上限', state.setup.roundLimit ?? 100),
      metric('领先文明', ranking[0]?.playerId ?? '无'),
    ],
    data: { ranking, outcome: state.outcome, roundLimit: state.setup.roundLimit ?? 100,
      frozenScores: Object.values(state.players).map(player => ({ playerId: player.id, frozenScore: player.frozenScore })) },
  };
}

function inspectAi(state: GameState): AuditSystemInspection {
  const activePlayer = state.players[state.activePlayerId];
  const view = observe(state, activePlayer.id);
  const nextCommand = planNext(view, RULE_QUERIES);
  const rows = Object.values(state.players).map(player => {
    const playerView = observe(state, player.id);
    return { playerId: player.id, controller: player.controller, personality: player.personality,
      leaderId: player.leaderId ?? null, knownCombatCounts: Object.values(state.players)
        .filter(other => other.id !== player.id).map(other => ({ ownerId: other.id, known: knownCombatCount(playerView, other.id),
          actual: Object.values(state.units).filter(unit => unit.ownerId === other.id && unit.kind === 'pokemon').length })) };
  });
  return {
    metrics: [
      ...baseMetrics(AUDIT_SYSTEM_BY_ID.get('s16-ai')!, state),
      metric('AI 文明', Object.values(state.players).filter(player => player.controller === 'ai').length),
      metric('候选预算', 256),
      metric('候选（未含拒绝记忆）', nextCommand.action.type),
    ],
    data: { activePlayerId: activePlayer.id, nextCommand, players: rows,
      limitation: '此候选未传入 CommandLog.aiRejectedCitySites，可能与含拒绝记忆的 AI 单步不同；历史缺陷分类位于模拟工具输出。' },
  };
}

function inspectDiplomacy(state: GameState): AuditSystemInspection {
  const rows = state.diplomacy.map(relation => ({ players: [relation.a, relation.b], status: relation.status,
    changedAtRound: relation.changedAtRound, cooldownUntilRound: relation.cooldownUntilRound,
    proposal: relation.proposal, rejectedAtRound: relation.rejectedAtRound, citiesLostSinceWar: relation.citiesLostSinceWar }));
  return {
    metrics: [
      ...baseMetrics(AUDIT_SYSTEM_BY_ID.get('s17-diplomacy')!, state),
      metric('关系总数', rows.length),
      metric('战争关系', rows.filter(row => row.status === 'war').length),
      metric('和平关系', rows.filter(row => row.status === 'peace').length),
      metric('待回应提议', rows.filter(row => row.proposal !== null).length),
    ],
    data: { relations: rows, activeRelationFor: Object.values(state.players).map(player => ({ playerId: player.id,
      relations: Object.values(state.players).filter(other => other.id !== player.id)
        .map(other => ({ otherId: other.id, ...relationFor(state.diplomacy, player.id, other.id) })) })) },
  };
}

function inspectLeaders(state: GameState): AuditSystemInspection {
  const selected = Object.values(state.players).map(player => player.leaderId ?? 'none');
  return {
    metrics: [
      ...baseMetrics(AUDIT_SYSTEM_BY_ID.get('leaders')!, state),
      metric('领袖定义', Object.keys(LEADERS).length),
      metric('已选择领袖', selected.filter(id => id !== 'none').length),
      metric('无领袖/旧档席位', selected.filter(id => id === 'none').length),
    ],
    data: { selectedByLeader: tally(selected),
      players: Object.values(state.players).map(player => ({ playerId: player.id, leaderId: player.leaderId ?? null,
        effects: player.leaderId === undefined ? null : LEADERS[player.leaderId].effects })),
      definitions: Object.values(LEADERS).map(leader => ({ id: leader.id, name: leader.name, effects: leader.effects })) },
  };
}

function inspectContent(state: GameState): AuditSystemInspection {
  const counts = { species: Object.keys(contentOf(state).species).length, buildings: Object.keys(contentOf(state).buildings).length,
    techs: Object.keys(contentOf(state).techs).length, balls: Object.keys(contentOf(state).balls).length,
    biomes: Object.keys(contentOf(state).biomes).length, moveCosts: Object.keys(contentOf(state).moveCosts).length };
  return {
    metrics: [
      ...baseMetrics(AUDIT_SYSTEM_BY_ID.get('x1-content')!, state),
      metric('内容版本', `${state.contentVersion} / ${contentOf(state).version}`),
      metric('物种', counts.species), metric('建筑', counts.buildings),
      metric('科技', counts.techs), metric('球种', counts.balls),
    ],
    data: { stateContentVersion: state.contentVersion, loadedContentVersion: contentOf(state).version, counts,
      compatible: state.contentVersion === contentOf(state).version },
  };
}

function inspectAuthority(state: GameState): AuditSystemInspection {
  const serialized = canonicalSerialize(state);
  return {
    metrics: [
      ...baseMetrics(AUDIT_SYSTEM_BY_ID.get('x2-authority')!, state),
      metric('Schema', state.schemaVersion), metric('规则版本', state.rulesVersion),
      metric('内容版本', state.contentVersion), metric('命令序号', state.commandSeq),
      metric('实体数', Object.keys(state.units).length + Object.keys(state.cities).length),
    ],
    data: { activePlayerId: state.activePlayerId, turnOrder: state.turnOrder,
      nextEntityId: state.nextEntityId, commandSeq: state.commandSeq,
      canonicalLength: serialized.length, stateDigest: stateDigest(state),
      players: Object.values(state.players).map(player => ({ id: player.id, controller: player.controller, eliminated: player.eliminated })) },
  };
}

function inspectDeterminism(state: GameState): AuditSystemInspection {
  const serialized = canonicalSerialize(state);
  return {
    metrics: [
      ...baseMetrics(AUDIT_SYSTEM_BY_ID.get('x3-determinism')!, state),
      metric('随机算法', state.rng.algorithm), metric('随机游标', state.rng.value),
      metric('种子', state.setup.seed), metric('规范序列长度', serialized.length),
      metric('诊断摘要', stateDigest(state)),
    ],
    data: { rng: state.rng, seed: state.setup.seed, canonicalLength: serialized.length,
      digest: stateDigest(state), digestRole: 'diagnostic only; equality still requires full canonical comparison' },
  };
}

function inspectPersistence(state: GameState): AuditSystemInspection {
  const setupIds = state.setup.players.map(player => player.id).sort((a, b) => a - b);
  const stateIds = Object.keys(state.players).map(Number).sort((a, b) => a - b);
  return {
    metrics: [
      ...baseMetrics(AUDIT_SYSTEM_BY_ID.get('x4-persistence')!, state),
      metric('Schema', state.schemaVersion), metric('规则版本', state.rulesVersion),
      metric('内容版本', state.contentVersion), metric('玩家一致', `${setupIds.join(',')} → ${stateIds.join(',')}`),
    ],
    data: { supported: { ...gameVersions(state.setup), contentVersion: contentOf(state).version },
      setupPlayerIds: setupIds, statePlayerIds: stateIds, commandSeq: state.commandSeq,
      playerSeats: state.setup.players.map(player => ({ id: player.id, controller: player.controller, leaderId: player.leaderId ?? null })),
      limitation: 'GameState inspection cannot prove localStorage save/load success; that is exercised by save/session tests.' },
  };
}

function inspectReplay(state: GameState): AuditSystemInspection {
  return {
    metrics: [
      ...baseMetrics(AUDIT_SYSTEM_BY_ID.get('x5-replay')!, state),
      metric('已接受命令数', state.commandSeq),
      metric('命令日志位置', 'GameState 之外'),
      metric('AI 拒绝记忆位置', 'CommandLog.aiRejectedCitySites'),
    ],
    data: { commandSeq: state.commandSeq, expectedLogCommandCount: state.commandSeq,
      authoritativeCommandLogPresent: false, reason: 'GameState intentionally stores only commandSeq; the save envelope supplies the log.' },
  };
}

function inspectPresentation(state: GameState): AuditSystemInspection {
  const mapUnits = Object.values(state.units).filter(isMapUnit).length;
  const rows = Object.values(state.players).map(player => ({ playerId: player.id,
    visibleUnits: observe(state, player.id).units.length,
    visibleCities: observe(state, player.id).cities.length }));
  return {
    metrics: [
      ...baseMetrics(AUDIT_SYSTEM_BY_ID.get('x6-presentation')!, state),
      metric('可渲染地图单位', mapUnits),
      metric('城市', Object.keys(state.cities).length),
      metric('玩家视图', rows.length),
      metric('表现状态入档', '否'),
    ],
    data: { mapUnitCount: mapUnits, cityCount: Object.keys(state.cities).length, playerViews: rows,
      authorityBoundary: 'Camera, animation, timing, and DOM state are runtime-only presentation state.' },
  };
}

function inspectDebug(state: GameState): AuditSystemInspection {
  const serialized = canonicalSerialize(state);
  return {
    metrics: [
      ...baseMetrics(AUDIT_SYSTEM_BY_ID.get('x7-debug')!, state),
      metric('状态长度', serialized.length), metric('单位数', Object.keys(state.units).length),
      metric('城市数', Object.keys(state.cities).length),
      metric('调试修改标记', '字段不存在'),
    ],
    data: { canonicalLength: serialized.length, digest: stateDigest(state),
      implementedInView: ['god view', 'command export', 'replay-to-sequence', 'last rejection', 'frame metrics', 'standalone audit sandbox'],
      missingAuthorityFeatures: ['DebugCommand', 'debugModified', 'tile/rule inspector overlays', 'vision/wild/AI overlays'],
      readOnlyGuarantee: 'inspectSystem derives its values without calling step or mutating GameState.' },
  };
}

function inspectSimulation(state: GameState): AuditSystemInspection {
  return {
    metrics: [
      ...baseMetrics(AUDIT_SYSTEM_BY_ID.get('x8-simulation')!, state),
      metric('模拟轮次', state.round), metric('命令序号', state.commandSeq),
      metric('存活文明', Object.values(state.players).filter(player => !player.eliminated).length),
      metric('当前结局', state.outcome?.kind ?? '进行中'),
    ],
    data: { round: state.round, commandSeq: state.commandSeq, outcome: state.outcome,
      players: Object.values(state.players).map(player => ({ id: player.id, controller: player.controller, eliminated: player.eliminated })),
      limitation: 'Run manifests, telemetry, defect counts, and abort flags belong to tools output files, not GameState.' },
  };
}

function inspectValidation(state: GameState): AuditSystemInspection {
  return {
    metrics: [
      ...baseMetrics(AUDIT_SYSTEM_BY_ID.get('x9-validation')!, state),
      metric('内容物种', Object.keys(contentOf(state).species).length),
      metric('权威 Schema', state.schemaVersion),
      metric('规则版本', state.rulesVersion),
      metric('内容版本', state.contentVersion),
    ],
    data: { versions: { schemaVersion: state.schemaVersion, rulesVersion: state.rulesVersion, contentVersion: state.contentVersion },
      staticCounts: { species: Object.keys(contentOf(state).species).length, buildings: Object.keys(contentOf(state).buildings).length,
        techs: Object.keys(contentOf(state).techs).length, balls: Object.keys(contentOf(state).balls).length },
      testResults: 'not claimed from GameState; run the repository test commands for current evidence' },
  };
}

function inspectPerformance(state: GameState): AuditSystemInspection {
  const serialized = canonicalSerialize(state);
  return {
    metrics: [
      ...baseMetrics(AUDIT_SYSTEM_BY_ID.get('x10-performance')!, state),
      metric('地图格子', state.map.tiles.length),
      metric('单位数', Object.keys(state.units).length),
      metric('城市数', Object.keys(state.cities).length),
      metric('状态长度', serialized.length),
    ],
    data: { mapTiles: state.map.tiles.length, units: Object.keys(state.units).length,
      cities: Object.keys(state.cities).length, canonicalLength: serialized.length,
      frameMetrics: 'browser runtime only; not part of GameState' },
  };
}

function inspectPlanned(system: AuditSystem, state: GameState): AuditSystemInspection {
  const missing = PLANNED_AUTHORITY_GAPS[system.id] ?? [];
  return {
    metrics: [
      ...baseMetrics(system, state),
      metric('权威字段缺口', authorityFieldCount(missing)),
      metric('实现状态', '未接入规则引擎'),
    ],
    data: { systemId: system.id, status: system.status, summary: system.summary,
      missingAuthorityFields: missing, existingStateEvidence: plannedEvidence(system.id, state),
      limitation: '这些指标只说明当前权威状态缺少实现；不生成默认数值来伪装游戏行为。' },
  };
}

const IMPLEMENTED_INSPECTORS: Record<string, (state: GameState) => AuditSystemInspection> = {
  's1-map': inspectMap,
  's2-vision': inspectVision,
  's3-cities': inspectCities,
  's4-population': inspectPopulation,
  's5-economy': inspectEconomy,
  's6-buildings': inspectBuildings,
  's7-research': inspectResearch,
  's8-species': inspectSpecies,
  's9-wild': inspectWild,
  's10-capture': inspectCapture,
  's11-evolution': inspectEvolution,
  's12-movement': inspectMovement,
  's13-combat': inspectCombat,
  's14-types': inspectTypes,
  's15-victory': inspectVictory,
  's16-ai': inspectAi,
  's17-diplomacy': inspectDiplomacy,
  leaders: inspectLeaders,
  'x1-content': inspectContent,
  'x2-authority': inspectAuthority,
  'x3-determinism': inspectDeterminism,
  'x4-persistence': inspectPersistence,
  'x5-replay': inspectReplay,
  'x6-presentation': inspectPresentation,
  'x7-debug': inspectDebug,
  'x8-simulation': inspectSimulation,
  'x9-validation': inspectValidation,
  'x10-performance': inspectPerformance,
};

export function inspectSystem(systemId: string, state: GameState): AuditSystemInspection {
  const system = AUDIT_SYSTEM_BY_ID.get(systemId);
  if (!system) return {
    metrics: [metric('系统状态', '未知系统'), metric('请求 ID', systemId),
      metric('当前轮次', state.round), metric('命令序号', state.commandSeq)],
    data: { error: 'Unknown audit system.', requestedId: systemId,
      availableSystems: AUDIT_SYSTEMS.map(item => item.id) },
  };
  const worldSystems = ['s18-nests', 's19-overlords', 's20-berries', 's21-evolution-stones', 's22-pokedex'];
  const civilizationSystems = ['s23-faith', 's24-sanctuaries', 's25-trainers', 's26-origin-victory', 's27-championship', 's28-deep-diplomacy'];
  if (system.id === 'leaders-active' || worldSystems.includes(system.id) || civilizationSystems.includes(system.id)) {
    const expansion = state.expansion;
    if (!expansion) return { metrics: [metric('规则包', '经典规则，扩展系统未启用'), metric('当前轮次', state.round)],
      data: { expansionVersion: state.setup.expansionVersion ?? null, instructions: '新建扩展对局或载入扩展存档后可调试本系统。' } };
    const world = expansion.world, civ = expansion.civilization;
    const data = system.id === 'leaders-active' ? expansion.leaders
      : system.id === 's18-nests' ? { nests: world.nests, rampagingUnitIds: world.rampagingUnitIds }
      : system.id === 's19-overlords' ? world.overlords
      : system.id === 's20-berries' || system.id === 's21-evolution-stones' ? { resources: world.resources, players: world.players }
      : system.id === 's22-pokedex' ? { victory: world.victory, players: world.players }
      : system.id === 's23-faith' || system.id === 's25-trainers' ? { players: civ.players, production: civ.pendingProductionByCity }
      : system.id === 's24-sanctuaries' || system.id === 's26-origin-victory' ? { sanctuaries: civ.sanctuaries, tabletOwners: civ.tabletOwners, victory: civ.victory }
      : system.id === 's27-championship' ? civ.championship : civ.relations;
    return { metrics: [metric('扩展规则版本', expansion.version), metric('当前轮次', state.round), metric('当前文明', state.activePlayerId + 1), metric('命令序号', state.commandSeq)], data };
  }
  if (system.id === 's29-multiplayer') return { metrics: [metric('当前局模式', state.setup.multiplayer ? '多席位' : '单人本地'), metric('席位数', Object.keys(state.players).length)],
    data: { controllerByPlayer: state.setup.players, client: '/multiplayer.html', server: 'npm run server', authority: 'HTTP server authenticates each seat and returns only its projected view.', tokens: 'Never exposed by this local audit inspector.' } };
  if (system.id === 's-opening') {
    const opening = state.expansion?.opening;
    if (!opening) return { metrics: [metric('当前规则', '未启用（需 v21）')], data: {} };
    return { metrics: [metric('当前规则', '开局节奏 v21'), metric('地图上的道具球', Object.keys(opening.itemBalls).length),
      ...Object.entries(opening.objectives).map(([id, done]) => metric(`玩家 ${id} 开局目标`, `${done.length}/8`))], data: { itemBalls: opening.itemBalls, seenByPlayer: opening.seen } };
  }
  if (system.id === 's-tech-tree') {
    const tree = contentOf(state).techTree === true;
    return { metrics: [metric('当前规则', tree ? '分支科技树 v22' : '三层科技（v≤21）'), metric('科技定义', Object.keys(contentOf(state).techs).length),
      ...Object.values(state.players).map(player => metric(`玩家 ${player.id} 已完成`, `${player.research.unlockedIds.length}/${Object.keys(contentOf(state).techs).length}`))],
      data: { tree, players: Object.values(state.players).map(player => ({ playerId: player.id, tree: player.research.tree === true, unlockedIds: player.research.unlockedIds, techId: player.research.techId })) } };
  }
  if (system.id === 's-combat-strength') {
    return { metrics: [metric('当前规则', (state.setup.gameplayVersion ?? 0) >= 20 ? '战斗力 v20' : '乘法公式（v≤19）')], data: {} };
  }
  if (system.id === 's-unit-classes') {
    return { metrics: [metric('当前规则', (state.setup.gameplayVersion ?? 0) >= 19 ? '兵种 v19' : '未启用（需 v19）')], data: {} };
  }
  if (system.id === 's-role-pokemon') {
    const roles = Object.values(state.units).filter(unit => unit.kind === 'logistics');
    return { metrics: [metric('当前规则', (state.setup.gameplayVersion ?? 0) >= 18 ? '工匠施工 v18' : '宝可梦施工（v≤17）'),
      metric('开拓队', roles.filter(unit => unit.kind === 'logistics' && unit.role === 'settler').length),
      metric('工匠', roles.filter(unit => unit.kind === 'logistics' && unit.role === 'builder').length),
      metric('商队', roles.filter(unit => unit.kind === 'logistics' && unit.role === 'trader').length)], data: {} };
  }
  if (system.id === 's-city-network') {
    const network = state.expansion?.cityNetwork;
    return { metrics: [metric('当前规则', network ? '城市网络 v17' : '本局未启用（需 v17）'), metric('商路', network?.routes.length ?? 0)], data: { cityNetwork: network ?? null } };
  }
  if (system.id === 's-movement-points') {
    const enabled = (state.setup.gameplayVersion ?? 0) >= 16, moved = Object.values(state.units).filter(unit => (unit.movesSpent ?? 0) > 0);
    return { metrics: [metric('当前规则', enabled ? '移动力 v16' : '每轮一次行动（v≤15）'), metric('本轮已移动的单位', moved.length)],
      data: { movesSpent: Object.fromEntries(moved.map(unit => [unit.id, unit.movesSpent])) } };
  }
  if (system.id === 's-legend-wonders') {
    const ledger = state.expansion?.legends;
    return { metrics: [metric('当前规则', ledger ? '传说奇观 v15' : '本局未启用（需 v15 时代对局）'), metric('踪迹', Object.keys(ledger?.sites ?? {}).length),
      metric('已建成奇观', Object.keys(ledger?.wonders ?? {}).length), metric('线索总数', Object.values(ledger?.clues ?? {}).reduce((sum, list) => sum + list.length, 0))],
      data: { legends: ledger ?? null } };
  }
  if (system.id === 's-roster') {
    const content = contentOf(state), owned = Object.values(state.units).filter(unit => unit.ownerId !== null && unit.kind === 'pokemon');
    return { metrics: [metric('当前规则', content.roster ? '阵容包 v14' : '本局未启用（需 v14）'), metric('物种数', Object.keys(content.species).length),
      metric('在场的新物种单位', owned.filter(unit => unit.kind === 'pokemon' && content.species[unit.speciesId]?.generation !== undefined).length)],
      data: { contentVersion: content.version, generationRecruits: content.roster?.generationRecruits ?? null } };
  }
  if (system.id === 's-promotions') {
    const ledger = state.expansion?.promotions, records = Object.values(ledger?.units ?? {});
    return { metrics: [metric('当前规则', ledger ? '玩法 v13' : '本局未启用（需 v13）'), metric('有战功的单位', records.length),
      metric('已选特性', records.reduce((sum, record) => sum + record.traits.length, 0))], data: { promotions: ledger ?? null } };
  }
  if (system.id === 's-era-honors') {
    const honors = state.expansion?.eraHonors;
    return { metrics: [metric('当前规则', honors ? '时代玩法 v12' : '本局未启用（需 v12）'),
      metric('黄金世代文明', Object.values(honors?.players ?? {}).filter(record => record.age === 'golden').length),
      metric('黑暗世代文明', Object.values(honors?.players ?? {}).filter(record => record.age === 'dark').length)], data: { eraHonors: honors ?? null } };
  }
  if (system.id === 's-governments') {
    const policies = state.expansion?.policies, enabled = Object.values(policies ?? {}).some(ledger => ledger.government !== undefined);
    const rows = Object.entries(policies ?? {}).map(([playerId, ledger]) => ({ playerId: Number(playerId), government: ledger.government ?? null,
      freeChange: ledger.governmentFreeSwap ?? null, slots: slotCounts(ledger.adopted, ledger.government ?? null), slotted: ledger.slotted }));
    return { metrics: [metric('当前规则', enabled ? '时代玩法 v11' : '本局未启用（需 v11）'),
      metric('已采用体制的文明', rows.filter(row => row.government).length)], data: { governments: enabled ? rows : null } };
  }
  if (system.id === 's-districts') {
    const districts = state.expansion?.districts, projects = districts ? districtProjects(Object.values(state.cities)) : [];
    return { metrics: [metric('当前规则', districts ? '时代玩法 v10' : '本局未启用（需显式 v10）'),
      metric('已完成设施区', Object.keys(districts?.tiles ?? {}).length), metric('排队设施区', projects.length)],
      data: { districts: districts ?? null, projects,
        effectsByCity: Object.fromEntries(Object.values(state.cities).sort((a, b) => a.id - b.id).map(city => [city.id, cityDistrictEffects(state, city.id)])) } };
  }
  if (system.id === 's31-improvements') {
    const improvements = state.expansion?.improvements;
    return { metrics: [metric('当前规则', improvements ? '时代玩法 v2' : '本局未启用（需时代玩法 v2）'), metric('已建改良', improvements ? Object.keys(improvements.tiles).length : 0),
      metric('施工中', improvements ? Object.keys(improvements.projects).length : 0)],
      data: { improvements: improvements ?? null, setup: { gameplayVersion: state.setup.gameplayVersion ?? null } } };
  }
  if (system.id === 's32-discoveries') {
    const discoveries = state.expansion?.discoveries;
    return { metrics: [metric('当前规则', discoveries ? '时代玩法 v2' : '本局未启用（需时代玩法 v2）'),
      metric('当前文明已发现', discoveries ? (discoveries[state.activePlayerId] ?? []).length : 0)],
      data: { discoveries: discoveries ?? null } };
  }
  if (system.id === 's33-field-tactics') return { metrics: [metric('当前规则', usesTactics(state.setup) ? '时代玩法 v2' : '本局未启用（需时代玩法 v2）'),
    metric('夹击上限', `+${FLANK_MAX / 10}%`)], data: { flankPerUnit: FLANK_PER_UNIT, flankMax: FLANK_MAX, zocRoles: ['melee', 'fast'], ignoresZoc: ['scout', 'air', 'ghost'] } };
  if (system.id === 's34-policies') {
    const ledger = state.expansion?.policies?.[state.activePlayerId];
    return { metrics: [metric('当前规则', ledger ? '时代玩法 v3' : '本局未启用（需时代玩法 v3）'), metric('已确立规章', ledger?.adopted.length ?? 0), metric('已用方针卡', ledger?.slotted.length ?? 0)],
      data: { policies: state.expansion?.policies ?? null } };
  }
  if (system.id === 's35-essences') {
    const essences = state.expansion?.essences;
    return { metrics: [metric('当前规则', essences ? '时代玩法 v4' : '本局未启用（需时代玩法 v4）'), metric('道馆数', essences ? Object.keys(essences.gyms).length : 0)],
      data: { essences: essences ?? null } };
  }
  if (system.id === 's36-era-abilities') {
    const era = state.expansion?.eraAbilities;
    return { metrics: [metric('当前规则', era ? '时代玩法 v5' : '本局未启用（需时代玩法 v5）'), metric('生效天气', era ? era.fields.filter(field => field.untilRound >= state.round).length : 0)],
      data: { eraAbilities: era ?? null } };
  }
  if (system.id === 's37-bonds') {
    const bonds = state.expansion?.bonds;
    return { metrics: [metric('当前规则', bonds ? '时代玩法 v6' : '本局未启用（需时代玩法 v6）'), metric('羁绊低于 30 的城市', bonds ? Object.values(bonds).filter(value => value < 30).length : 0)],
      data: { bonds: bonds ?? null } };
  }
  if (system.id === 's38-rare-berries') {
    const rare = state.expansion?.rareBerries;
    return { metrics: [metric('当前规则', rare ? '时代玩法 v7' : '本局未启用（需时代玩法 v7）'), metric('矿点数', rare ? Object.keys(rare.deposits).length : 0)],
      data: { rareBerries: rare ?? null } };
  }
  if (system.id === 's39-contests') {
    const contests = state.expansion?.contests;
    return { metrics: [metric('当前规则', contests ? '时代玩法 v8' : '本局未启用（需时代玩法 v8）'), metric('当前文明人气', contests?.[state.activePlayerId]?.appeal ?? 0)],
      data: { contests: contests ?? null } };
  }
  if (system.id === 's40-faith') {
    const faith = state.expansion?.faith;
    return { metrics: [metric('当前规则', faith ? '时代玩法 v9' : '本局未启用（需时代玩法 v9）'), metric('已创立信仰', faith ? Object.keys(faith.faiths).length : 0)],
      data: { faith: faith ?? null } };
  }
  if (system.id === 's30-type-expansion') return { metrics: [metric('当前规则', state.expansion ? '18 属性、双属性防御' : '经典克制表'), metric('物种数', Object.keys(contentOf(state).species).length)],
    data: { species: contentOf(state).species, rule: 'Primary attack type; multiply defensive types; immunity zero; one final floor.' } };
  if (system.id === 'x11-content-editor') return { metrics: [metric('内容版本', contentOf(state).version), metric('物种数', Object.keys(contentOf(state).species).length)],
    data: { editor: '/editor.html', editable: ['species', 'buildings', 'techs', 'balls', 'balance'], validation: 'src/editor/content.ts', execution: 'src/editor/sandbox.ts', sharedContent: 'Immutable baseline; editor drafts are isolated.' } };
  if (system.status === 'planned') return inspectPlanned(system, state);
  const inspector = IMPLEMENTED_INSPECTORS[system.id];
  return inspector ? inspector(state) : {
    metrics: baseMetrics(system, state),
    data: { systemId: system.id, status: system.status, error: 'No state inspector is registered for this implemented system.' },
  };
}
