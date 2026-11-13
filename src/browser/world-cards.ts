// World page = "next action" (docs/design/depth-v26.md §6.1–6.2, playtest U4): a row of cards that say where the next gym,
// rival, conference, contest, nest, sanctuary, legend trail, catch and evolution are, each with a locate button, and the
// league conference bracket. Presentation only: everything is read from the PlayerView (already fog-filtered: gyms on explored
// tiles, nests / sanctuaries / wild Pokémon in sight, legend traces seen or explored), no rule is computed differently.
import { ELITE_FOUR, GYM_LEADERS, GYM_RULES_V24, STAGE_NAMES } from '../content/gym-circuit.ts';
import { LEGEND_WONDERS } from '../content/legend-wonders.ts';
import type { LegendWonderId } from '../content/legend-wonders.ts';
import { RIVAL_RULES_V24 } from '../content/rivals.ts';
import { rivalStayRounds, world24Tuning } from '../content/world24-tuning.ts';
import { TYPE_NAMES } from '../content/type-names.ts';
import { victoryTargets } from '../content/opening.ts';
import { CIVILIZATION_CONTENT } from '../content/civilization-systems.ts';
import { CONTEST_RULES } from '../core/contests.ts';
import { contentForView, unitDefinition } from '../content/units.ts';
import type { Content } from '../content/units.ts';
import { leaderTeamFor } from '../core/gym-circuit.ts';
import { viewIsRivalUnit } from '../core/rivals.ts';
import { previewCapture } from '../core/preview.ts';
import { hexDistance, hexToIndex, indexToHex } from '../core/hex.ts';
import type { Hex } from '../core/hex.ts';
import type { Command, MapUnit, PlayerView } from '../core/model.ts';
import type { ChampionshipSeason } from '../core/civilization-systems.ts';
import { pokemonSpritePath } from './sprites.ts';
import { artImage, escapeAttr, flagImage, statChip, uiIcon } from './ui-icons.ts';
import type { UiIconName } from './ui-icons.ts';
import { captureBlocker, evolutionState } from './unit-action-bar.ts';

type Pokemon = Extract<MapUnit, { kind: 'pokemon' }>;
export type WorldCardId = 'gym' | 'rival' | 'conference' | 'contest' | 'nest' | 'sanctuary' | 'legend' | 'capture' | 'evolution';
export type CardArt = { icon: UiIconName } | { sprite: string };
/**
 * One next-action card. `tileIndex`: what the locate button centres on (always a tile the viewer sees or has explored);
 * `unitId`: an own unit to select instead. `urgency`: 0 = a countdown of 2 rounds or less, 1 = can act now, 2 = soon, 3 = later.
 */
export type WorldCard = { id: WorldCardId; title: string; status: string; tip: string; art: CardArt; urgency: number; distance: number | null;
  tileIndex?: number; unitId?: number; action?: { label: string; command: Command['action']; available: boolean } };

/** Civilization colours of the map (render/canvas2d.ts FACTIONS). */
export const CIV_COLORS = ['#3BA68A', '#D3655C', '#9B83D0', '#D59A45'];
const civName = (view: PlayerView, id: number | null) => id === null ? '无主' : id === view.playerId ? '你' : `文明 ${id + 1}`;
export const legendSpritePath = (id: LegendWonderId) => {
  const dex = LEGEND_WONDERS[id].dex;
  return `/sprites/${dex <= 386 ? 'gen3' : dex <= 493 ? 'gen4' : dex <= 649 ? 'gen5' : dex <= 721 ? 'gen6' : dex <= 809 ? 'gen7' : dex <= 905 ? 'gen8' : 'gen9'}/${dex}.png`;
};

/** Tiles from the nearest own unit or city (wrap-aware); null when the viewer has neither. */
export function ownDistance(view: PlayerView, position: Hex): number | null {
  const anchors = [...view.units.filter(unit => unit.ownerId === view.playerId).map(unit => unit.position), ...view.economy.cities.map(city => city.position)];
  return anchors.length ? Math.min(...anchors.map(anchor => hexDistance(anchor, position, view.map))) : null;
}
const nearest = <T extends { position: Hex }>(view: PlayerView, items: readonly T[]) =>
  [...items].map(item => ({ item, distance: ownDistance(view, item.position) ?? Infinity }))
    .sort((a, b) => a.distance - b.distance)[0];
const tileOf = (view: PlayerView, position: Hex) => hexToIndex(position, view.map) ?? undefined;
const finite = (distance: number) => Number.isFinite(distance) ? distance : null;

/** The cards for the viewer, most urgent first (stable: urgency, then distance, then the order above). */
export function worldCards(view: PlayerView, content: Content = contentForView(view)): WorldCard[] {
  const exp = view.expansion;
  if (!exp) return [];
  const cards: WorldCard[] = [], me = view.playerId, player = view.economy.player;
  const own = view.units.filter((unit): unit is Pokemon => unit.ownerId === me && unit.kind === 'pokemon');

  // Next gym: the nearest discovered circuit gym not yet won; the Elite Four once all badges are in.
  const circuit = exp.gymCircuit;
  if (circuit) {
    const won = circuit.badges[me] ?? [], next = leaderTeamFor(won.length, content);
    const open = nearest(view, circuit.gyms.filter(gym => !won.includes(gym.id)));
    if (open) {
      const gym = open.item, ready = (circuit.readyAt[gym.id] ?? 0) <= view.round;
      cards.push({ id: 'gym', title: `${GYM_LEADERS[gym.leader].name}的道馆`, art: { icon: `gym:${gym.typeId}` },
        status: `${TYPE_NAMES[gym.typeId]} · 馆主 ${next.members} 只${STAGE_NAMES[next.stage]}${ready ? '' : ` · ${circuit.readyAt[gym.id] - view.round} 轮后可再挑战`}`,
        tip: `下一座道馆：${GYM_LEADERS[gym.leader].name}（${TYPE_NAMES[gym.typeId]}属性）。\n你的下一位馆主：${next.members} 只${STAGE_NAMES[next.stage]}，战力 ${next.power}（随你已有的徽章数提高）。\n徽章 ${won.length}/${GYM_RULES_V24.gymCount}。带 1–3 只宝可梦：一只站在道馆上，其余在 2 格内。`,
        urgency: 3, distance: finite(open.distance), tileIndex: gym.tileIndex });
    } else if (won.length >= GYM_RULES_V24.gymCount && !circuit.eliteFour[me]?.won) {
      cards.push({ id: 'gym', title: '四天王', art: { icon: 'trophy' }, status: `徽章已集齐 · 派 ${GYM_RULES_V24.eliteFour.team} 只连战`,
        tip: `集齐 ${GYM_RULES_V24.gymCount} 枚徽章，可以挑战四天王（${ELITE_FOUR.map(member => member.name).join('、')}）：赢了冠军赛头衔 +1（每局一次）。`, urgency: 1, distance: null });
    } else if (won.length < GYM_RULES_V24.gymCount) {
      cards.push({ id: 'gym', title: '寻找道馆', art: { icon: 'badge' }, status: `徽章 ${won.length}/${GYM_RULES_V24.gymCount} · 去探索`,
        tip: '还没有发现没挑战过的道馆。派宝可梦探索地图，道馆会出现在已探索的地块上。', urgency: 3, distance: null });
    }
  }

  // The own rival: the warned tile, the rival Pokémon in sight, or the next arrival round.
  const rivals = exp.rivals;
  if (rivals) {
    const hunting = view.units.filter(unit => rivals.activeUnitIds.includes(unit.id));
    if (rivals.pending) {
      const left = rivals.pending.round - view.round, capital = player.headquartersCityId === rivals.pending.cityId;
      cards.push({ id: 'rival', title: `劲敌${rivals.name}`, art: { icon: 'rival' }, status: `${left <= 0 ? '本轮' : `${left} 轮后`}登场 · ${capital ? '首都' : `城市 ${rivals.pending.cityId}`}`,
        tip: `劲敌${rivals.name}第 ${rivals.encounter + 1} 次登场：第 ${rivals.pending.round} 轮，目标${capital ? '首都' : `城市 ${rivals.pending.cityId}`}（只有你看得到这条预告）。\n它带克制你御三家的宝可梦，停留 ${rivalStayRounds(content, rivals.encounter)} 轮后离开；全部击倒有奖励。`,
        urgency: left <= 2 ? 0 : 2, distance: 0, tileIndex: rivals.pending.tileIndex });
    } else if (rivals.activeUnitIds.length) {
      const seen = nearest(view, hunting);
      cards.push({ id: 'rival', title: `劲敌${rivals.name}`, art: { icon: 'rival' }, status: `在你的领土附近 · 还剩 ${rivals.activeUnitIds.length} 只`,
        tip: `劲敌${rivals.name}正在你的领土附近（第 ${rivals.encounter} 次登场）。只打你的宝可梦和城市，不能捕捉；全部击倒有奖励。`,
        urgency: 0, distance: seen ? finite(seen.distance) : null, ...(seen ? { tileIndex: tileOf(view, seen.item.position) } : {}) });
    } else if (rivals.nextArrival !== null) {
      const left = rivals.nextArrival - view.round;
      cards.push({ id: 'rival', title: `劲敌${rivals.name}`, art: { icon: 'rival' }, status: `第 ${rivals.nextArrival} 轮登场（${left} 轮）`,
        tip: `劲敌在第 ${world24Tuning(content).rivalArrivals.join(' / ')} 轮登场，提前 ${RIVAL_RULES_V24.warningRounds} 轮预告目标城市。`, urgency: 3, distance: null });
    }
  }

  // League conference: countdown, registration, titles.
  const championship = exp.civilization.championship;
  if (!championship.victory) {
    const left = championship.nextRound - view.round, titles = championship.titlesByPlayer[me] ?? 0;
    const need = (view.gameplayVersion ?? 0) >= 21 ? victoryTargets(view).championshipTitles : CIVILIZATION_CONTENT.championship.titlesNeededForVictory;
    const peaceful = !view.diplomacy.some(pair => pair.status === 'war' && [pair.a, pair.b].includes(me));
    const team = own.slice(0, 6).map(unit => unit.id);
    cards.push({ id: 'conference', title: `联盟大会 第 ${championship.nextSeason} 届`, art: { icon: 'trophy' },
      status: `${left <= 0 ? '本轮' : `${left} 轮后`} · ${championship.registration ? '已报名' : '未报名'} · 冠军 ${titles}/${need}`,
      tip: `第 ${championship.nextRound} 轮举办，六队淘汰赛（前两名轮空）。和平时报名六只宝可梦。\n冠军头衔 ${titles}/${need}：本局（${view.roundLimit} 轮）要 ${need} 个头衔；${circuit ? '四天王最多算 1 个，其余' : '头衔都'}来自联盟大会冠军。`,
      urgency: left <= 2 && !championship.registration ? 0 : left <= 2 ? 1 : 3, distance: null,
      ...(championship.registration ? {} : { action: { label: '报名', command: { type: 'RegisterChampionshipTeam', unitIds: team } as Command['action'], available: peaceful && own.length >= 6 } }) });
  }

  // Contest: appeal, cooldown, the hall to locate.
  const contests = exp.contests;
  if (contests) {
    const cooldown = Math.max(0, contests.own.showReadyAtRound - view.round), top = Math.max(0, ...contests.rivals.map(rival => rival.appeal));
    const hall = view.economy.cities.find(city => contests.own.halls.includes(city.id));
    const canHold = contests.own.halls.length > 0 && player.gold >= CONTEST_RULES.showGold && cooldown === 0;
    cards.push({ id: 'contest', title: '华丽大赛', art: { icon: 'ribbon' },
      status: !contests.own.halls.length ? '还没有大赛馆' : cooldown ? `${cooldown} 轮后可举办` : '可以举办',
      tip: `人气 ${contests.own.appeal}（每轮 +${contests.own.perRound}），对手最高 ${top}。\n大赛馆 ${contests.own.halls.length} 座；举办一次 ${CONTEST_RULES.showGold} 金，冷却 ${CONTEST_RULES.showCooldown} 轮。`,
      urgency: canHold ? 1 : 3, distance: null, ...(hall ? { tileIndex: tileOf(view, hall.position) } : {}),
      ...(contests.own.halls.length ? { action: { label: '举办', command: { type: 'HoldContest' } as Command['action'], available: canHold } } : {}) });
  }

  // The nearest rampaging nest in sight.
  const nest = nearest(view, exp.world.nests);
  if (nest) cards.push({ id: 'nest', title: '暴走巢穴', art: { icon: 'nest' }, status: `HP ${nest.item.hp}/${nest.item.maxHp} · 第 ${nest.item.nextSpawnRound} 轮刷新`,
    tip: `巢穴 HP ${nest.item.hp}/${nest.item.maxHp}，第 ${nest.item.nextSpawnRound} 轮再派出野生宝可梦。派宝可梦到射程内清剿。`,
    urgency: 2, distance: finite(nest.distance), tileIndex: nest.item.tileIndex });

  // The nearest sanctuary in sight that still has something to do.
  const sanctuary = nearest(view, exp.civilization.sanctuaries.filter(site => !(site.ownerId === me && site.guardianDefeated)));
  if (sanctuary) {
    const site = sanctuary.item;
    cards.push({ id: 'sanctuary', title: site.name, art: { sprite: pokemonSpritePath(site.guardianSpeciesId) },
      status: site.ownerId === null ? '未控制 · 建立 80 金' : site.ownerId === me ? `挑战守卫${site.guardianName}` : `${civName(view, site.ownerId)}控制`,
      tip: `${site.name}：守卫${site.guardianName}，石板「${site.tabletName}」。\n派单位抵达并支付 80 金建立圣所，再派最多三只宝可梦在两格内挑战守卫；集齐四块石板获得起源胜利。`,
      urgency: 3, distance: finite(sanctuary.distance), tileIndex: tileOf(view, site.position) });
  }

  // The nearest legend trace not yet built.
  const legends = exp.legends;
  if (legends) {
    const traces = legends.sites.filter(site => !legends.wonders.some(wonder => wonder.legendId === site.legendId))
      .map(site => ({ ...site, position: indexToHex(site.tileIndex, view.map) }));
    const trace = nearest(view, traces);
    if (trace) {
      const legend = LEGEND_WONDERS[trace.item.legendId], clue = legends.clues.includes(trace.item.legendId);
      cards.push({ id: 'legend', title: `${legend.name}的踪迹`, art: { sprite: legendSpritePath(trace.item.legendId) },
        status: clue ? '已得线索' : '还没有线索',
        tip: `${legend.name} · ${legend.wonderName}（第 ${legend.generation} 世代）。${clue ? '你已经有线索，可以在符合条件的城市建造。' : '踪迹在这里；满足线索条件后可以建造传说奇观。'}`,
        urgency: 3, distance: finite(trace.distance), tileIndex: trace.item.tileIndex });
    }
  }

  // Catch: the nearest wild Pokémon in sight (rival Pokémon cannot be caught).
  const wild = view.units.filter((unit): unit is Pokemon => unit.ownerId === null && unit.kind === 'pokemon' && !viewIsRivalUnit(view, unit.id));
  const target = nearest(view, wild);
  if (target) {
    const unit = target.item, species = content.species[unit.speciesId], blocked = captureBlocker(view);
    const ball = player.ballInventory.greatBall > 0 && player.research.unlockedIds.includes('ballCraft') ? 'greatBall' : 'pokeBall';
    const chance = own.map(item => previewCapture(view, item.id, unit.id, ball, content)).find(preview => preview.ok);
    cards.push({ id: 'capture', title: species.name, art: { sprite: pokemonSpritePath(unit.speciesId) },
      status: blocked ? '还不能捕捉' : chance?.ok ? `捕捉率 ${chance.probability}%` : `HP ${unit.hp}/${species.maxHp} · 精灵球 ${player.ballInventory.pokeBall}`,
      tip: `野生${species.name}（HP ${unit.hp}/${species.maxHp}）。${blocked ?? '相邻的宝可梦可以捕捉；先削弱它，捕捉率更高。'}\n精灵球 ${player.ballInventory.pokeBall} · 超级球 ${player.ballInventory.greatBall}。`,
      urgency: chance?.ok ? 1 : 3, distance: finite(target.distance), tileIndex: tileOf(view, unit.position) });
  }

  // Close to evolving: can evolve now first, else the highest EXP share (at least 70%).
  const growing = own.map(unit => ({ unit, state: evolutionState(view, unit, content) }))
    .filter(({ state }) => state.evolution && !state.stoneEvolution)
    .map(item => ({ ...item, share: item.unit.xp / Math.max(1, item.state.evolution!.xp) }))
    .filter(item => item.state.canEvolve || item.share >= .7)
    .sort((a, b) => Number(b.state.canEvolve) - Number(a.state.canEvolve) || b.share - a.share || a.unit.id - b.unit.id)[0];
  if (growing) {
    const { unit, state } = growing, into = content.species[state.evolution!.speciesId].name;
    cards.push({ id: 'evolution', title: `${unitDefinition(unit, content).name} → ${into}`, art: { sprite: pokemonSpritePath(unit.speciesId) },
      status: state.canEvolve ? '可以进化' : `EXP ${unit.xp}/${state.evolution!.xp}`,
      tip: `${unitDefinition(unit, content).name}（#${unit.id}）进化成${into}：EXP ${unit.xp}/${state.evolution!.xp}，需 ${state.evolution!.gold} 金。选中它后在单位操作栏进化。`,
      urgency: state.canEvolve ? 1 : 3, distance: 0, unitId: unit.id });
  }
  const order: WorldCardId[] = ['rival', 'conference', 'gym', 'evolution', 'capture', 'contest', 'nest', 'sanctuary', 'legend'];
  return cards.sort((a, b) => a.urgency - b.urgency || (a.distance ?? 99) - (b.distance ?? 99) || order.indexOf(a.id) - order.indexOf(b.id));
}

const esc = escapeAttr;
const artMarkup = (art: CardArt, label: string, size = 40) => 'icon' in art ? uiIcon(art.icon, { size, label }) : artImage(art.sprite, { size, label });
/** The locate button: an icon whose accessible name is the full target. */
export const locateButton = (tileIndex: number, label: string) =>
  `<button type="button" class="locate-btn" data-locate-tile="${tileIndex}" aria-label="定位：${esc(label)}" title="定位：${esc(label)}">${uiIcon('locate', { size: 18 })}</button>`;
export const selectUnitButton = (unitId: number, label: string) =>
  `<button type="button" class="locate-btn" data-locate-unit="${unitId}" aria-label="选中：${esc(label)}" title="选中：${esc(label)}">${uiIcon('locate', { size: 18 })}</button>`;

/** The card row. `button` renders an action through the panel's own command path. */
export function worldCardsMarkup(cards: readonly WorldCard[], button: (label: string, action: Command['action'], available?: boolean) => string): string {
  if (!cards.length) return '';
  return `<section class="next-cards" aria-label="下一步"><h3 class="next-head">${uiIcon('map', { size: 18 })}下一步</h3><div class="next-grid">${cards.map(card => {
    const name = `${card.title}：${card.status}`;
    return `<article class="next-card${card.urgency === 0 ? ' urgent' : card.urgency === 1 ? ' ready' : ''}" data-card="${card.id}" data-tip="${esc(card.tip)}" tabindex="0" aria-label="${esc(`${name}。${card.tip}`)}">
      <div class="next-art">${artMarkup(card.art, name)}</div>
      <div class="next-text"><b>${esc(card.title)}</b><span>${esc(card.status)}</span></div>
      <div class="next-foot">${card.distance !== null && card.distance > 0 ? statChip('move', `${card.distance} 格`, '距最近的己方单位或城市') : '<span></span>'}
        <span class="next-actions">${card.action ? button(card.action.label, card.action.command, card.action.available) : ''}${card.tileIndex !== undefined ? locateButton(card.tileIndex, card.title)
          : card.unitId !== undefined ? selectUnitButton(card.unitId, card.title) : ''}</span></div></article>`;
  }).join('')}</div></section>`;
}

// ---------- league conference bracket (§6.2) ----------

const ROUND_LABELS = { preliminary: '预赛', semifinal: '半决赛', final: '决赛' } as const;
/** Six-team bracket of the latest season: lead sprites, civilization banners (NPC trainers), scores = remaining HP. */
export function bracketMarkup(view: PlayerView, season: ChampionshipSeason | undefined, titles: { own: number; need: number }): string {
  if (!season) return '';
  const content = contentForView(view), eliteFour = Boolean(view.expansion?.gymCircuit);
  const entrant = (id: string) => season.entrants.find(item => item.entrantId === id)!;
  const who = (id: string) => {
    const item = entrant(id), lead = item.roster[0];
    const name = item.playerId === null ? `NPC 训练家 ${id.split('-').at(-1)}` : civName(view, item.playerId);
    const mark = item.playerId === null ? uiIcon('trainer', { size: 18, label: name }) : flagImage(CIV_COLORS[item.playerId] ?? '#5F6E66', { size: 18, label: name });
    return { name, mark, lead: lead ? artImage(pokemonSpritePath(lead.speciesId), { size: 32, label: `${name}的首发：${content.species[lead.speciesId]?.name ?? ''}` }) : '' };
  };
  const slot = (id: string, score: number, won: boolean) => {
    const item = who(id);
    return `<li class="bracket-slot${won ? ' won' : ''}${entrant(id).playerId === view.playerId ? ' own' : ''}" aria-label="${esc(`${item.name} · 剩余 HP ${score}${won ? ' · 胜' : ''}`)}">${item.mark}${item.lead}<span>${esc(item.name)}</span><b>${score}</b></li>`;
  };
  const column = (kind: keyof typeof ROUND_LABELS) => `<div class="bracket-round" data-round="${kind}"><h4>${ROUND_LABELS[kind]}</h4><div class="bracket-matches">${season.matches.filter(match => match.label.startsWith(kind))
    // Preliminary 2's winner meets the top seed in semifinal 1, so it is drawn first, next to that semifinal.
    .sort((a, b) => Number(b.label === 'preliminary-2') - Number(a.label === 'preliminary-2')).map(match =>
    `<ol class="bracket-match" data-match="${match.label}">${match.entrantIds.map((id, side) => slot(id, match.scores[side], match.winnerEntrantId === id)).join('')}</ol>`).join('')}</div></div>`;
  const champion = who(season.championEntrantId), seeds = season.entrants.filter(item => !season.matches.some(match => match.label.startsWith('preliminary') && match.entrantIds.includes(item.entrantId)));
  return `<section class="conference-bracket" aria-label="联盟大会对阵表"><h3 class="next-head">${uiIcon('trophy', { size: 18 })}联盟大会 · 第 ${season.season} 届（第 ${season.round} 轮）</h3>
    <p class="bracket-note">轮空：${seeds.map(item => esc(who(item.entrantId).name)).join('、')} · 比分是剩余 HP <span class="title-count" data-tip="${esc(`冠军头衔 ${titles.own}/${titles.need}：本局（${view.roundLimit} 轮）要 ${titles.need} 个头衔即胜利；${eliteFour ? '四天王最多算 1 个，其余' : '头衔都'}来自联盟大会冠军。`)}" tabindex="0" role="img" aria-label="${esc(`你的冠军头衔 ${titles.own}/${titles.need}；本局要 ${titles.need} 个头衔${eliteFour ? '，四天王最多算 1 个' : ''}`)}">${uiIcon('trophy', { size: 14 })}<b>${titles.own}/${titles.need}</b></span></p>
    <div class="bracket">${column('preliminary')}${column('semifinal')}${column('final')}<div class="bracket-round bracket-champion"><h4>冠军</h4><div class="bracket-matches"><div class="champion-card">${uiIcon('trophy', { size: 36, label: `第 ${season.season} 届冠军：${champion.name}` })}${champion.mark}${champion.lead}<b>${esc(champion.name)}</b></div></div></div></div></section>`;
}
