// Gameplay v26 late game in the browser (docs/design/depth-v26.md §5, §6.1, §7.2, §8): next-action cards (contest season, Max Raid,
// legend race, near-victory warning, spare gold), the world-page section for TMs / special training / contest entries, the city
// panel's rush buttons and the notifications. Presentation only: every number comes from the PlayerView through the same quote /
// blocker functions the authority uses (gold-sinks.ts, contest-seasons.ts), so a button is enabled exactly when the command is valid.
import { TYPE_ESSENCE } from '../content/essences.ts';
import { lateTuning } from '../content/depth-v26.ts';
import { LEGEND_WONDERS } from '../content/legend-wonders.ts';
import { TYPE_NAMES } from '../content/type-names.ts';
import type { TypeId } from '../content/species.ts';
import type { Content } from '../content/units.ts';
import { contentForView, unitDefinition } from '../content/units.ts';
import { CONTEST_CATEGORY_INFO, CONTEST_SEASON_REASONS, contestScore, viewContestEntryBlocker } from '../core/contest-seasons.ts';
import type { ContestCategory } from '../core/contest-seasons.ts';
import { GOLD_SINK_REASONS, viewGoldSinkQuote, viewTaughtMoveType } from '../core/gold-sinks.ts';
import type { GoldSinkAction } from '../core/gold-sinks.ts';
import { hexDistance, hexToIndex, indexToHex } from '../core/hex.ts';
import type { Command, MapUnit, PlayerView, VisibleEvent } from '../core/model.ts';
import { viewBadges } from '../core/unit-classes.ts';
import type { VictoryRoute } from '../core/victory-watch.ts';
import { pokemonSpritePath } from './sprites.ts';
import { artImage, escapeAttr, statChip, typeBadge, uiIcon } from './ui-icons.ts';
import type { UiIconName } from './ui-icons.ts';
import type { WorldCard } from './world-cards.ts';

type Pokemon = Extract<MapUnit, { kind: 'pokemon' }>;
const esc = escapeAttr;
const civ = (view: PlayerView, id: number) => id === view.playerId ? '你' : `文明 ${id + 1}`;
export const CATEGORY_ICONS: Record<ContestCategory, UiIconName> = { cool: 'contestCool', beauty: 'contestBeauty', cute: 'contestCute', smart: 'contestSmart', tough: 'contestTough' };
export const ROUTE_NAMES: Record<VictoryRoute, string> = { conquest: '征服', pokedex: '图鉴', origin: '起源', championship: '冠军赛', contest: '华丽大赛', faith: '信仰' };
const STAGE_NAMES = { started: '开工', half: '过半', final: '即将完成' } as const;
const ownPokemon = (view: PlayerView) => view.units.filter((unit): unit is Pokemon => unit.ownerId === view.playerId && unit.kind === 'pokemon').sort((a, b) => a.id - b.id);
const quoteText = (quote: ReturnType<typeof viewGoldSinkQuote>) => quote.ok ? (quote.free ? '免费（徽章）' : `${quote.gold} 金`) : GOLD_SINK_REASONS[quote.reason] ?? quote.reason;
/** The best own entrant for the announced category (any distance), for the card and the panel. */
function bestEntrant(view: PlayerView, content: Content): { unit: Pokemon; score: number } | null {
  const seasons = view.expansion?.contestSeasons, halls = view.expansion?.contests?.own.halls.length ?? 0;
  if (!seasons?.category) return null;
  return ownPokemon(view).map(unit => ({ unit, score: contestScore(content, unit.speciesId, unit.xp, viewTaughtMoveType(view, unit.id), halls, seasons.category!) }))
    .sort((a, b) => b.score - a.score || Number(viewContestEntryBlocker(view, a.unit.id, content) !== null) - Number(viewContestEntryBlocker(view, b.unit.id, content) !== null) || a.unit.id - b.unit.id)[0] ?? null;
}

// ---------- next-action cards (§6.1) ----------
export function depthWorldCards(view: PlayerView, content: Content = contentForView(view)): WorldCard[] {
  const exp = view.expansion, cards: WorldCard[] = [], player = view.economy.player;
  if (!exp) return cards;
  const seasons = exp.contestSeasons;
  if (seasons && seasons.nextRound !== null) {
    const left = seasons.nextRound - view.round, best = bestEntrant(view, content), hall = view.economy.cities.find(city => exp.contests?.own.halls.includes(city.id));
    const entryUnit = best && viewContestEntryBlocker(view, best.unit.id, content) === null ? best.unit : ownPokemon(view).find(unit => viewContestEntryBlocker(view, unit.id, content) === null);
    const category = seasons.category ? CONTEST_CATEGORY_INFO[seasons.category] : null;
    cards.push({ id: 'season', title: `华丽大赛季 第 ${seasons.season} 届`, art: { icon: seasons.category ? CATEGORY_ICONS[seasons.category] : 'ribbon' },
      status: `${category ? category.name : '类别未公布'} · ${left <= 0 ? '本轮评审' : `${left} 轮后`}${seasons.ownEntry ? ' · 已参赛' : ''}`,
      tip: `第 ${seasons.nextRound} 轮轮末评审；赛前 ${lateTuning(content).seasonAnnounce} 轮（第 ${seasons.announceRound} 轮）公布类别后开放报名。\n`
        + (category ? `本届「${category.name}」加分属性：${category.types.map(type => TYPE_NAMES[type]).join('、')}。\n` : '')
        + `得分 = 20 × 匹配属性（最多 2，学习器也算）+ 10 × 阶段 + 历练 + 5 × 大赛馆（最多 4）+ 0–9 决胜。名次人气：+${lateTuning(content).seasonRewards.join(' / +')}，其余 +${lateTuning(content).seasonEntryAppeal}；冠军得缎带。`
        + (best ? `\n你的最佳人选：${unitDefinition(best.unit, content).name}（#${best.unit.id}）${best.score} 分。` : '')
        + `\n缎带：${Object.entries(seasons.ribbons).map(([id, count]) => `${civ(view, Number(id))} ×${count}`).join('、') || '还没有'}。`,
      urgency: seasons.category && !seasons.ownEntry ? (left <= 2 ? 0 : 1) : 3, distance: null,
      ...(hall ? { tileIndex: hexToIndex(hall.position, view.map) ?? undefined } : {}),
      ...(seasons.category && !seasons.ownEntry ? { action: { label: '参赛', command: { type: 'EnterContest', unitId: entryUnit?.id ?? best?.unit.id ?? 0 } as Command['action'], available: Boolean(entryUnit) } } : {}) });
  }
  const raids = exp.raids;
  if (raids?.active) {
    const boss = raids.active, unit = boss.unitId === null ? undefined : view.units.find(item => item.id === boss.unitId), name = content.species[boss.speciesId]?.name ?? '';
    const total = Object.values(boss.damage).reduce((sum, value) => sum + value, 0);
    cards.push({ id: 'raid', title: `极巨巢穴：${name}`, art: { sprite: pokemonSpritePath(boss.speciesId) },
      status: `${unit ? `HP ${unit.hp}/${boss.maxHp}` : `HP ${boss.maxHp}`} · 第 ${boss.endsAtRound} 轮后离开`,
      tip: `本地区的${name}出现在${boss.tileIndex === null ? '远方（你还没探索过那里）' : '地图上'}，不移动，每轮末攻击所有相邻单位，不能捕捉。\n用普通攻击打它：伤害第一的文明得到这只宝可梦（出现在离巢最近的己方城市旁）和世代分 +1；伤害 ≥ 10% 的文明各得金币（每 10% 份额 ${lateTuning(content).raidShareGold} 金，最多 ${lateTuning(content).raidMaxGold}）。\n伤害：${Object.entries(boss.damage).map(([id, value]) => `${civ(view, Number(id))} ${value}（${total ? Math.round(value * 100 / total) : 0}%）`).join('、') || '还没有人出手'}。`,
      urgency: 0, distance: boss.tileIndex === null ? null : hexDistanceToOwn(view, boss.tileIndex), ...(boss.tileIndex === null ? {} : { tileIndex: boss.tileIndex }) });
  } else if (raids?.nextRound) {
    cards.push({ id: 'raid', title: '极巨巢穴', art: { icon: 'raid' }, status: `第 ${raids.nextRound} 轮出现`,
      tip: `从第 ${lateTuning(content).raidFirstRound} 轮起每 ${lateTuning(content).raidInterval} 轮，远离所有首都的地方会出现一只本地区的三阶或稀有宝可梦，停留 ${lateTuning(content).raidRounds} 轮。`,
      urgency: raids.nextRound - view.round <= 2 ? 0 : 3, distance: null });
  }
  const race = exp.legends?.race ?? [];
  if (race.length) {
    const top = [...race].sort((a, b) => ['final', 'half', 'started'].indexOf(a.stage) - ['final', 'half', 'started'].indexOf(b.stage) || a.playerId - b.playerId)[0];
    cards.push({ id: 'legendRace', title: '传说神殿竞赛', art: { icon: 'wonder' }, status: `${civ(view, top.playerId)} · ${LEGEND_WONDERS[top.legendId].wonderName} ${STAGE_NAMES[top.stage]}`,
      tip: `已相遇文明在建的传说奇观（只给档位，不给城市和轮数）：\n${race.map(entry => `${civ(view, entry.playerId)}：${LEGEND_WONDERS[entry.legendId].wonderName}（${STAGE_NAMES[entry.stage]}）`).join('\n')}\n别人先建成，你在建的同一座只退一半生产（折金币）。`,
      urgency: top.stage === 'final' ? 1 : 3, distance: null });
  }
  for (const alarm of (exp.victoryWatch ?? []).filter(item => item.playerId !== view.playerId).slice(0, 1)) {
    cards.push({ id: 'alarm', title: `接近胜利：${civ(view, alarm.playerId)}`, art: { icon: 'alarm' }, status: `${ROUTE_NAMES[alarm.route]} ${alarm.percent}%`,
      tip: `${civ(view, alarm.playerId)}在第 ${alarm.round} 轮达到${ROUTE_NAMES[alarm.route]}胜利的 ${lateTuning(content).watchPercent}%（现在 ${alarm.percent}%）。\n${ALARM_HINTS[alarm.route]}`,
      urgency: 0, distance: null });
  }
  const sinks = exp.goldSinks;
  if (sinks) {
    const rushable = view.economy.cities.map(city => ({ city, quote: viewGoldSinkQuote(view, { type: 'RushProduction', cityId: city.id }, content) }))
      .filter(item => item.quote.ok).sort((a, b) => (a.quote.ok ? a.quote.gold : 0) - (b.quote.ok ? b.quote.gold : 0) || a.city.id - b.city.id);
    if (rushable.length && player.gold >= 150) {
      const first = rushable[0];
      cards.push({ id: 'goldSink', title: '金币可以花', art: { icon: 'rush' }, status: `金币 ${player.gold} · ${rushable.length} 座城可加急`,
        tip: `加急采购：当前生产项剩余生产 × ${lateTuning(content).rushBuildingGold} 金（建筑）/ × ${lateTuning(content).rushUnitGold} 金（宝可梦、职能单位），本轮末完成；每城每轮 1 次。\n${rushable.map(item => `城市 ${item.city.id}：${quoteText(item.quote)}`).join('\n')}\n另有宝可梦中心（休养立刻归队）、特训和招式学习器（世界页「训练与学习器」）。`,
        urgency: player.gold >= 500 ? 1 : 3, distance: null, tileIndex: hexToIndex(first.city.position, view.map) ?? undefined,
        action: { label: `加急城市 ${first.city.id}`, command: { type: 'RushProduction', cityId: first.city.id }, available: true } });
    }
  }
  return cards;
}
const hexDistanceToOwn = (view: PlayerView, tileIndex: number) => {
  const at = indexToHex(tileIndex, view.map), anchors = [...view.units.filter(unit => unit.ownerId === view.playerId).map(unit => unit.position), ...view.economy.cities.map(city => city.position)];
  return anchors.length ? Math.min(...anchors.map(anchor => hexDistance(anchor, at, view.map))) : null;
};
const ALARM_HINTS: Record<VictoryRoute, string> = {
  conquest: '保护好首都，与其他文明结盟。', pokedex: '它快集齐图鉴了：抢先捕捉和对战本地区的物种也拦不住它，只能更快或用征服打断。',
  origin: '它的石板快集齐了：去抢剩下的圣所。', championship: '在下一届联盟大会里击败它的队伍。',
  contest: '建大赛馆、举办大赛、在大赛季里拿名次——你的人气越高，它要达到的 1.5 倍门槛就越高。', faith: '在自己的城市传播信仰，阻止它改宗你的城市。',
};

// ---------- world page section: TMs, special training, contest entries (§5.1, §5.2) ----------
export function depthPanelCards(view: PlayerView, button: (label: string, action: Command['action'], available?: boolean, reason?: string) => string,
  card: (id: string, title: string, body: string) => string): string {
  const content = contentForView(view), sinks = view.expansion?.goldSinks;
  if (!sinks) return '';
  const types = (Object.keys(TYPE_ESSENCE) as TypeId[]).filter(type => viewBadges(view).has(TYPE_ESSENCE[type]));
  const rows = ownPokemon(view).map(unit => {
    const species = content.species[unit.speciesId], tm = sinks.moves[unit.id];
    const train = { type: 'SpecialTraining', unitId: unit.id } as const, trainQuote = viewGoldSinkQuote(view, train, content);
    const teach = types.filter(type => type !== species.typeId && type !== species.secondaryTypeId && type !== tm).map(type => {
      const action: GoldSinkAction = { type: 'TeachMove', unitId: unit.id, typeId: type }, quote = viewGoldSinkQuote(view, action, content);
      return button(`${TYPE_NAMES[type]} · ${quote.ok ? (quote.free ? '免费' : `${quote.gold} 金`) : '—'}`, action, quote.ok, quote.ok ? `教会${TYPE_NAMES[type]}属性招式` : quoteText(quote));
    }).join('');
    const entry = view.expansion?.contestSeasons?.category ? button('参加大赛季', { type: 'EnterContest', unitId: unit.id }, viewContestEntryBlocker(view, unit.id, content) === null,
      CONTEST_SEASON_REASONS[viewContestEntryBlocker(view, unit.id, content) ?? ''] ?? '派它参赛') : '';
    return `<div class="world-row depth-row" data-unit="${unit.id}">${artImage(pokemonSpritePath(unit.speciesId), { size: 32, label: species.name })}<span class="world-row-name">${esc(species.name)} <small>#${unit.id} · EXP ${unit.xp}</small></span>`
      + `${tm ? `${uiIcon('tm', { size: 16, label: '招式学习器' })}${typeBadge(tm, 16, `学习器：${TYPE_NAMES[tm]}属性`)}` : ''}`
      + `<span class="depth-actions">${button(`特训 · ${quoteText(trainQuote)}`, train, trainQuote.ok, trainQuote.ok ? `+${lateTuning(content).trainingXp} 经验` : quoteText(trainQuote))}${entry}${teach}</span></div>`;
  }).join('');
  const spent = Object.entries(sinks.spent).map(([kind, gold]) => `${SINK_NAMES[kind as GoldSinkAction['type']]} ${gold}`).join(' · ');
  return card('s-gold-sinks', `${uiIcon('training', { size: 18 })}训练与学习器`, `<p class="unit-note">特训：站在有宝可梦中心的己方城市里或旁边，${lateTuning(content).trainingGold} 金换 ${lateTuning(content).trainingXp} 经验（每只每 ${lateTuning(content).trainingCooldown} 轮 1 次）。`
    + `招式学习器：给一只宝可梦加 1 个只在对战与大赛季里用的属性，属性要属于你有徽章的精华；一、二阶 ${lateTuning(content).tmGold} 金，三阶 ${lateTuning(content).tmFinalGold} 金；每赢一枚巡回徽章送 1 张该道馆属性的学习器。</p>`
    + `<p class="world-stats">${statChip('tm', sinks.freeTms.length, '免费学习器')}${sinks.freeTms.map(type => typeBadge(type, 16)).join('')}${spent ? `<span class="unit-note">已花：${esc(spent)}</span>` : ''}</p>${rows || '<p>没有宝可梦。</p>'}`);
}
const SINK_NAMES: Record<GoldSinkAction['type'], string> = { RushProduction: '加急采购', RushRecovery: '宝可梦中心', SpecialTraining: '特训', TeachMove: '学习器' };

// ---------- city panel: rush buttons (§5.1) ----------
/** Rush the current item and bring this city's recovering Pokémon back; buttons carry `data-gold-sink` (see `bindGoldSinkButtons`). */
export function cityGoldSinkMarkup(view: PlayerView, cityId: number, disabled: boolean): string {
  const content = contentForView(view);
  if (!view.expansion?.goldSinks) return '';
  const rush: GoldSinkAction = { type: 'RushProduction', cityId }, quote = viewGoldSinkQuote(view, rush, content);
  const sinkButton = (action: GoldSinkAction, label: string, icon: UiIconName, ok: boolean, why: string) =>
    `<button type="button" class="gold-sink-btn" data-gold-sink="${esc(JSON.stringify(action))}" aria-label="${esc(`${label}：${why}`)}" title="${esc(why)}"${disabled || !ok ? ' disabled' : ''}>${uiIcon(icon, { size: 16 })}${esc(label)}</button>`;
  const recovering = view.recoveringUnits.filter(unit => unit.ownerId === view.playerId && unit.cityId === cityId && unit.kind === 'pokemon');
  return `<div class="gold-sinks" role="group" aria-label="金币加急">${sinkButton(rush, `加急 · ${quote.ok ? `${quote.gold} 金` : '—'}`, 'rush', quote.ok,
    quote.ok ? `花 ${quote.gold} 金立即买下当前生产项剩余的生产，本轮末完成（每城每轮 1 次）` : quoteText(quote))}`
    + recovering.map(unit => {
      const action: GoldSinkAction = { type: 'RushRecovery', unitId: unit.id }, item = viewGoldSinkQuote(view, action, content), name = unitDefinition(unit, content).name;
      return sinkButton(action, `${name} 立即归队 · ${item.ok ? `${item.gold} 金` : '—'}`, 'medicine', item.ok, item.ok ? `宝可梦中心：还要休养 ${unit.roundsLeft} 轮，花 ${item.gold} 金立即以 25% HP 归队` : quoteText(item));
    }).join('') + '</div>';
}
export function bindGoldSinkButtons(root: HTMLElement, issue: (action: Command['action']) => void): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-gold-sink]')) button.addEventListener('click', () => issue(JSON.parse(button.dataset.goldSink!) as Command['action']));
}

// ---------- legend page: the race bar (§5.3) ----------
/** One row per legend another met civilization is building: the legend's sprite, each builder's banner and 3-cell stage, own rounds left. */
export function legendRaceMarkup(view: PlayerView): string {
  const legends = view.expansion?.legends, race = legends?.race;
  if (!legends || !race?.length) return '';
  const production = Math.max(0, ...view.economy.cities.map(city => city.yields.production));
  const ids = [...new Set(race.map(entry => entry.legendId))].sort((a, b) => LEGEND_WONDERS[a].dex - LEGEND_WONDERS[b].dex);
  const cells = (stage: keyof typeof STAGE_NAMES) => {
    const filled = { started: 1, half: 2, final: 3 }[stage];
    return `<span class="race-cells" aria-hidden="true">${[1, 2, 3].map(index => `<i class="${index <= filled ? 'on' : ''}"></i>`).join('')}</span>`;
  };
  return `<section class="legend-race" aria-label="传说神殿竞赛"><h3>${uiIcon('wonder', { size: 18 })}神殿竞赛</h3>${ids.map(id => {
    const mine = legends.building.find(item => item.legendId === id), legend = LEGEND_WONDERS[id];
    const left = mine && production > 0 ? Math.ceil((mine.cost - mine.progress) / production) : null;
    return `<div class="race-row" data-legend="${id}">${artImage(legendSprite(legend.dex), { size: 32, label: legend.name })}<b>${esc(legend.wonderName)}</b>`
      + race.filter(entry => entry.legendId === id).map(entry => `<span class="race-entry" role="img" aria-label="${esc(`${civ(view, entry.playerId)}：${STAGE_NAMES[entry.stage]}`)}" title="${esc(`${civ(view, entry.playerId)}：${STAGE_NAMES[entry.stage]}`)}">${uiIcon('flag', { size: 16 })}${civ(view, entry.playerId)}${cells(entry.stage)}</span>`).join('')
      + (mine ? `<span class="race-entry own">你：还剩约 ${left ?? '?'} 轮</span>` : '') + '</div>';
  }).join('')}<p class="unit-note">只显示已相遇文明的档位（开工 &lt; 50%、过半、即将完成 ≥ 85%），不给城市和轮数。</p></section>`;
}
const legendSprite = (dex: number) => `/sprites/${dex <= 386 ? 'gen3' : dex <= 493 ? 'gen4' : dex <= 649 ? 'gen5' : dex <= 721 ? 'gen6' : dex <= 809 ? 'gen7' : dex <= 905 ? 'gen8' : 'gen9'}/${dex}.png`;

// ---------- notifications ----------
export type DepthToast = { tone: 'research' | 'production' | 'growth' | 'wonder' | 'war' | 'info'; icon: string; title: string; detail: string;
  target: { kind: 'screen'; screen: 'world' | 'legends' | 'research' } | { kind: 'unit'; unitId: number } | { kind: 'city'; cityId: number } | null; action?: string; persistent?: boolean; key?: string; strategic?: boolean };
export function depthToast(payload: VisibleEvent['payload'], view: PlayerView): DepthToast | null {
  const content = contentForView(view), me = view.playerId, world = { kind: 'screen', screen: 'world' } as const;
  switch (payload.type) {
    case 'OpeningGiftReceived':
      return payload.playerId === me ? { tone: 'growth', icon: '◓', title: `大木博士送来 ${payload.quantity} 个精灵球`, detail: '驯化完成：削弱相邻的野生宝可梦，再按 Q 捕捉。', target: null, action: '知道了', persistent: true } : null;
    case 'GoldSinkUsed': return null;
    case 'ContestSeasonJudged': {
      const own = payload.placings.find(item => item.playerId === me), first = payload.placings[0];
      return { tone: own?.place === 1 ? 'wonder' : 'info', icon: '✿', title: `华丽大赛季 第 ${payload.season} 届（${CONTEST_CATEGORY_INFO[payload.category].name}）`,
        detail: first ? `冠军：${civ(view, first.playerId)}的${content.species[first.speciesId]?.name ?? ''}（${first.score} 分）。${own ? `你第 ${own.place} 名，人气 +${own.appeal}。` : '你没有参赛。'}` : '没有文明参赛。',
        target: world, action: '查看', strategic: own?.place === 1 };
    }
    case 'RaidAppeared':
      return { tone: 'war', icon: '✸', title: `极巨巢穴出现：${content.species[payload.speciesId]?.name ?? ''}`, detail: payload.tileIndex === null ? '远方出现了极巨巢穴（你还没探索过那里）。' : `HP ${payload.hp}，第 ${payload.endsAtRound} 轮后离开。伤害第一的文明得到它。`,
        target: world, action: '查看', key: 'raid', strategic: true };
    case 'RaidDefeated':
      return { tone: payload.playerId === me ? 'wonder' : 'info', icon: '✸', title: payload.playerId === me ? `你赢得了极巨团体战：${content.species[payload.speciesId]?.name ?? ''}加入队伍！` : `${civ(view, payload.playerId)}赢得了极巨团体战`,
        detail: payload.gold[me] ? `你的伤害份额奖励 ${payload.gold[me]} 金。` : '', target: payload.playerId === me && payload.unitId !== null ? { kind: 'unit', unitId: payload.unitId } : world, key: 'raid', strategic: payload.playerId === me };
    case 'RaidEnded':
      return { tone: 'info', icon: '✸', title: `极巨巢穴的${content.species[payload.speciesId]?.name ?? ''}离开了`, detail: '没有被打倒。', target: null, key: 'raid' };
    case 'VictoryWatchAlarm':
      return payload.playerId === me ? { tone: 'growth', icon: '!', title: `你的${ROUTE_NAMES[payload.route]}胜利已达 ${payload.percent}%`, detail: '所有文明都收到了这条预警。', target: world }
        : { tone: 'war', icon: '!', title: `接近胜利：${civ(view, payload.playerId)}的${ROUTE_NAMES[payload.route]}已达 ${payload.percent}%`, detail: ALARM_HINTS[payload.route], target: world, action: '查看', persistent: true, key: `alarm:${payload.playerId}:${payload.route}`, strategic: true };
    case 'LegendWonderStarted':
      return { tone: 'wonder', icon: '♜', title: payload.stage === 'started' ? `${civ(view, payload.builderId)}开始建造${LEGEND_WONDERS[payload.legendId].wonderName}` : `${civ(view, payload.builderId)}的${LEGEND_WONDERS[payload.legendId].wonderName}即将完成`,
        detail: '传说页顶部的竞赛条显示各家档位。', target: { kind: 'screen', screen: 'legends' }, action: '查看传说', key: `race:${payload.builderId}:${payload.legendId}`, strategic: payload.stage === 'final' };
    default: return null;
  }
}
