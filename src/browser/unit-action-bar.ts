// Civilization 6-style unit action bar: one row of icon buttons fixed at the bottom-right of the
// map (outside the drawer), with hotkeys and a hover card that says why an action is unavailable.
// Buttons keep the ids of the old drawer buttons and dispatch exactly the same callbacks.
import { candyGold } from '../core/unit-classes.ts';
import { evolutionGold } from '../core/leader-systems.ts';
import { usesBuilders, usesImprovementsV23, improvementOptions, improvementYield, lockedImprovementHints } from '../core/improvements.ts';
import { pillageRewardLabel, viewPillage, viewRepairs } from '../core/pillage.ts';
import type { TechId } from '../content/economy.ts';
import { IMPROVEMENT_WORK, IMPROVEMENTS } from '../content/improvements.ts';
import type { ImprovementId } from '../content/improvements.ts';
import { contentForView, techOf, unitDefinition } from '../content/units.ts';
import type { Content } from '../content/units.ts';
import type { EvolutionOption, SpeciesId } from '../content/species.ts';
import { stoneEvolutionsFor } from '../content/roster.ts';
import { EVOLUTION_BLOCKER_TEXT, evolutionBlocker, evolutionOptions, playerGeneration, tileBiome } from '../core/roster.ts';
import { WORLD_DEFINITIONS } from '../content/world-systems.ts';
import { hexDistance, hexToIndex } from '../core/hex.ts';
import type { Command, MapUnit, PlayerView } from '../core/model.ts';
import { actionTargets } from './action-targets.ts';
import { viewGymBlocksCity } from '../core/gym-circuit.ts';
import type { ActionMode } from './unit-panel.ts';
import { gymBarState, gymTitle, nextLeaderText, openGymCard, refreshGymCard } from './gym-panel.ts';
import { openLineupPicker, refreshLineupPicker } from './lineup-picker.ts';
import { viewDuelCandidates } from '../core/rival-duels.ts';
import { rivalDuelSpec } from '../ai/rival-duel-plan.ts';
import { uiIcon } from './ui-icons.ts';
import type { UiIconName } from './ui-icons.ts';

type Pokemon = Extract<MapUnit, { kind: 'pokemon' }>;

// ---------- shared rules readers (also used by the drawer) ----------

/** Evolution state of a Pokémon: the main branch, whether it can evolve now, and why not. */
export function evolutionState(view: PlayerView, unit: Pokemon, content: Content) {
  const species = content.species[unit.speciesId], player = view.economy.player;
  // v19 Rare Candy: a stage-1 Pokémon short of XP may evolve for extra gold from the Gold/Silver era.
  const candyPrice = (option: { gold: number }) => candyGold(view, player, view.eraProgression, species.stage, evolutionGold(player, option.gold));
  const meets = (option: { xp: number; gold: number; requiresTraining: boolean }) => (unit.xp >= option.xp ? player.gold >= option.gold
    : candyPrice(option) !== null && player.gold >= candyPrice(option)!) && (!option.requiresTraining || player.research.unlockedIds.includes('training'));
  // v14 roster: evolution branches with generation / day-night / biome conditions; stone paths stay in the world panel.
  const stonePaths = stoneEvolutionsFor(content).filter(path => path.fromSpeciesId === unit.speciesId);
  const branchContext = { generation: playerGeneration(player, view.eraProgression), round: view.round, biome: tileBiome(view, unit.position) };
  const branches = content.roster ? evolutionOptions(content, unit.speciesId).filter(option => !stonePaths.some(path => path.intoSpeciesId === option.speciesId)) : [];
  const branchReady = (option: EvolutionOption) => meets(option) && !evolutionBlocker(content, option, branchContext);
  // Main button: a branch that can evolve now, else one whose conditions hold (only EXP / gold missing), else the first.
  const evolution = content.roster ? branches.find(branchReady) ?? branches.find(option => !evolutionBlocker(content, option, branchContext)) ?? branches[0] ?? null : species.evolution;
  const stoneEvolution = view.expansion && (content.roster ? !branches.length && stonePaths[0] : WORLD_DEFINITIONS.stoneEvolutions.find(path => path.fromSpeciesId === unit.speciesId));
  const canEvolve = Boolean(evolution && !stoneEvolution && (content.roster ? branchReady(evolution as EvolutionOption) : meets(evolution)));
  const blocker = content.roster && evolution && !canEvolve ? evolutionBlocker(content, evolution as EvolutionOption, branchContext) : null;
  return { evolution, stoneEvolution, canEvolve, blocker, branches, branchContext, branchReady, candyPrice };
}

/** Why the settler cannot found a city here (null when the known site rules hold). */
export function foundingReason(view: PlayerView, unit: MapUnit): string | null {
  const nearest = [...view.cities, ...Object.values(view.knowledge.lastKnownCities)]
    .reduce((distance, city) => Math.min(distance, hexDistance(unit.position, city.position, view.map)), Infinity);
  const biome = view.map.tiles[hexToIndex(unit.position, view.map)!];
  return !unit.actionLeft ? '本回合已行动。结束回合后，开拓队恢复行动点。'
    : biome === 'ocean' ? '海洋上无法建城，请选择陆地。'
    : viewGymBlocksCity(view, hexToIndex(unit.position, view.map)!) ? '巡回道馆所在的地块不能建城，请移到旁边的格子。'
    : nearest < 4 ? `距最近已知城市 ${nearest} 格，至少需要 4 格。请继续向外探索。` : null;
}

/** Why the player cannot capture at all (research or balls missing), or null. */
export function captureBlocker(view: PlayerView): string | null {
  const player = view.economy.player;
  if (!player.research.unlockedIds.includes('domestication')) return '需要先研究「驯化」，并在城市采购精灵球。';
  if (player.ballInventory.pokeBall > 0 || (player.research.unlockedIds.includes('ballCraft') && player.ballInventory.greatBall > 0)) return null;
  return '没有可用的精灵球：选中城市采购精灵球（超级球需要「制球术」）。';
}

// ---------- pixel icons (9×9 palette grids, same style as map-icons.ts) ----------

const K = '#17262A';
function pixelIcon(rows: readonly string[], palette: Record<string, string>): string {
  const colors: Record<string, string> = { k: K, w: '#FFF8E5', ...palette };
  const rects = rows.flatMap((row, y) => [...row].map((cell, x) => cell === '.' ? '' : `<rect x="${x}" y="${y}" width="1" height="1" fill="${colors[cell]}"/>`)).join('');
  return `<svg viewBox="0 0 ${rows[0].length} ${rows.length}" width="18" height="18" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}
const ICONS = {
  move: pixelIcon(['....k....', '....kk...', 'kkkkkak..', 'kaaaaaak.', 'kaaaaaaak', 'kaaaaaak.', 'kkkkkak..', '....kk...', '....k....'], { a: '#72C99E' }),
  attack: pixelIcon(['......kkk', '.....kwwk', '....kwwk.', '.k.kwwk..', '.kkwwk...', '..kwk....', '.kgkkk...', 'kgk.kk...', 'kk.......'], { g: '#E6B85C' }),
  capture: pixelIcon(['..kkkkk..', '.krrrrrk.', 'krrrrrrrk', 'krrkkkrrk', 'kkkkwkkkk', 'kwwkkkwwk', 'kwwwwwwwk', '.kwwwwwk.', '..kkkkk..'], { r: '#D3655C' }),
  evolve: pixelIcon(['....k....', '...kyk...', '...kyk...', '.kkkykkk.', 'kyyywyyyk', '.kkkykkk.', '...kyk...', '...kyk...', '....k....'], { y: '#9CD6F2' }),
  found: pixelIcon(['....k....', '...krk...', '..krrrk..', '.krrrrrk.', 'kkkkkkkkk', '.kwwwwwk.', '.kwwkwwk.', '.kwwkwwk.', '.kkkkkkk.'], { r: '#D3655C' }),
  improve: pixelIcon(['kkkkkk...', 'kssssk...', 'kssssskk.', 'kkkkbkk..', '...kbk...', '...kbk...', '...kbk...', '...kbk...', '...kkk...'], { s: '#B3C2BA', b: '#A0703A' }),
  pillage: pixelIcon(['k.......k', 'kk..k..kk', '.kkkrkkk.', '..krrrk..', '.krroorrk', '..krrrk..', '.kkkrkkk.', 'kk..k..kk', 'k.......k'], { r: '#E0483A', o: '#F2A93B' }),
  repair: pixelIcon(['.kk...kk.', 'kssk.kssk', 'ksssksssk', '.kssssk..', '..kssk...', '.kbbk....', 'kbbk.....', 'kbk......', 'kk.......'], { s: '#B3C2BA', b: '#A0703A' }),
  gym: pixelIcon(['..kkkkk..', '.krrrrrk.', 'kkkkwkkkk', 'kwwkwkwwk', '.kssssk..', '.kskkskk.', '.kskkskk.', '.kssssssk', 'kkkkkkkkk'], { r: '#D9495B', s: '#B9A57F' }),
  skip: pixelIcon(['k...k....', 'kk..kk...', 'kwk.kwk..', 'kwwkkwwk.', 'kwwwkwwwk', 'kwwkkwwk.', 'kwk.kwk..', 'kk..kk...', 'k...k....'], {}),
} as const;
type IconName = keyof typeof ICONS;

// ---------- the bar ----------

export type UnitBarCallbacks = {
  mode: (mode: ActionMode) => void;
  evolve: (intoSpeciesId?: SpeciesId) => void;
  found: () => void;
  improve: (tileIndex: number, kind: ImprovementId) => void;
  /** v23: pillage / repair orders (any other command the bar issues directly). */
  order?: (action: Command['action']) => void;
  /** Leave this unit waiting and select the next idle one. */
  skip: () => void;
  /** Shows a sentence in the map notice (used when a hotkey hits an unavailable action). */
  explain: (text: string) => void;
  /** v26 §7.1: toggle the go-to (waypoint) mode, and cancel the unit's standing go-to order. */
  goTo?: () => void;
  cancelGoTo?: () => void;
};
/** The selected unit's go-to state (client waypoints, waypoints.ts): choosing a target, an order with its turns left, just arrived. */
export type UnitBarGoTo = { mode: boolean; turns: number | null; arrived: boolean };
type BarAction = {
  id: string; action: string; icon?: IconName; kit?: UiIconName; label: string; hotkey: string; key: string;
  /** Full description (title line of the hover card, accessible name). */
  title: string; reason: string | null; detail: string; selected?: boolean; tone?: 'attack' | 'primary'; data?: string; attention?: boolean;
  /** U6: a small count on the button (the capture button shows the balls in stock). */
  count?: number;
};
const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Hotkeys of the bar (lower-case `event.key`; Space is ' '). Chosen to avoid C (city), F (fit), R/T, Y, Enter, Esc, +/−. */
export const UNIT_BAR_HOTKEYS = { move: 'm', goTo: 'w', cancelGoTo: 'backspace', attack: 'a', capture: 'q', evolve: 'e', found: 'b', improve: 'i', pillage: 'p', repair: 'x', gym: 'g', duel: 'd', skip: ' ' } as const;

type ImproveOption = { tileIndex: number; kind: ImprovementId; label: string };
function barActions(view: PlayerView, unit: MapUnit, mode: ActionMode, lock: string | null, goTo: UnitBarGoTo | null): { actions: BarAction[]; options: ImproveOption[] } {
  const content = contentForView(view), player = view.economy.player;
  const spent = unit.actionLeft ? null : '本回合已行动，结束回合后恢复。';
  const blocked = (reason: string | null) => lock ?? spent ?? reason;
  const actions: BarAction[] = [{
    id: 'move-unit', action: 'move', icon: 'move', label: '移动', hotkey: 'M', key: UNIT_BAR_HOTKEYS.move,
    title: mode === 'move' ? '取消移动' : '移动', reason: blocked(null), selected: mode === 'move',
    detail: mode === 'move' ? '点击地图上的高亮格移动；再按一次取消。' : '显示可到达的格子，点击高亮格移动（也可右键直接移动）。',
  }];
  // v26 §7.1 go-to: available even with no moves left this round (the order starts next turn).
  if (goTo) {
    actions.push({
      id: 'goto-unit', action: 'goto', kit: 'goTo', label: '前往', hotkey: 'W', key: UNIT_BAR_HOTKEYS.goTo, selected: goTo.mode,
      title: goTo.mode ? '取消选择路标' : goTo.turns !== null ? `前往 · 路标约 ${goTo.turns} 轮到达` : '前往（多回合）', reason: lock,
      detail: goTo.mode ? '点击地图上任意格子设路标：虚线是路线，圆圈数字是第几回合走到那里。Esc 取消。'
        : '设一个远处的路标：之后每回合开始时自动走一段，遇敌、受到攻击、被挡住或你另下命令时停下。也可右键点远处的格子。',
    });
    if (goTo.turns !== null) actions.push({
      id: 'cancel-goto-unit', action: 'cancel-goto', kit: 'goTo', label: '停止', hotkey: '⌫', key: UNIT_BAR_HOTKEYS.cancelGoTo,
      title: '取消路标', reason: lock, detail: '清除这个单位的路标，它回到待命单位里。',
    });
  }
  if (unit.kind === 'pokemon') {
    const targets = unit.actionLeft ? actionTargets(view, unit.id, 'attack', 'pokeBall').length : 0;
    actions.push({
      id: 'attack-unit', action: 'attack', icon: 'attack', label: '攻击', hotkey: 'A', key: UNIT_BAR_HOTKEYS.attack, tone: 'attack',
      title: mode === 'attack' ? '取消攻击' : '攻击', reason: blocked(null), selected: mode === 'attack',
      detail: targets ? `射程内 ${targets} 个可攻击目标（红色虚线），选中后确认攻击。` : '射程内暂无可攻击目标（和平中的文明不能攻击）。',
    });
    const capture = captureBlocker(view);
    actions.push({
      id: 'capture-unit', action: 'capture', icon: 'capture', label: '捕捉', hotkey: 'Q', key: UNIT_BAR_HOTKEYS.capture,
      title: mode === 'capture' ? '取消捕捉' : '捕捉', reason: blocked(capture), selected: mode === 'capture', count: player.ballInventory.pokeBall + player.ballInventory.greatBall,
      detail: `点相邻的野生宝可梦看捕捉率，再点一次即捕捉。精灵球 ${player.ballInventory.pokeBall} · 超级球 ${player.ballInventory.greatBall}（顶栏球数可前往城市采购）`,
    });
    const state = evolutionState(view, unit, content), evolution = state.evolution;
    const candy = evolution && unit.xp < evolution.xp ? state.candyPrice(evolution) : null;
    const missing = evolution ? [
      unit.xp < evolution.xp && candy === null ? `EXP ${unit.xp}/${evolution.xp}` : '',
      player.gold < (candy ?? evolutionGold(player, evolution.gold)) ? `金币 ${player.gold}/${candy ?? evolutionGold(player, evolution.gold)}` : '',
      evolution.requiresTraining && !player.research.unlockedIds.includes('training') ? '科技「特训法」' : '',
    ].filter(Boolean) : [];
    // Playtest 2026-11 B3: a stone path is named before "no form" (stone-only species have no main branch).
    const evolveReason = state.stoneEvolution ? `需要${WORLD_DEFINITIONS.stones[state.stoneEvolution.stoneId].name} + EXP ${state.stoneEvolution.requiredXp}，请在「世界 › 树果、进化石与满意度」中使用。`
      : !evolution ? '没有可进化的形态。'
      : state.blocker ? `${EVOLUTION_BLOCKER_TEXT[state.blocker]}。`
      : state.canEvolve ? null : `还差：${missing.join('、') || '条件未满足'}。`;
    actions.push({
      id: 'evolve-unit', action: 'evolve', icon: 'evolve', label: '进化', hotkey: 'E', key: UNIT_BAR_HOTKEYS.evolve,
      title: evolution ? `${candy !== null ? `神奇糖果 · ${candy} 金 → ` : '进化→'}${content.species[evolution.speciesId].name}`
        : state.stoneEvolution ? `进化石进化→${content.species[state.stoneEvolution.intoSpeciesId]?.name ?? ''}` : '不可进化',
      reason: blocked(evolveReason), data: content.roster && evolution ? evolution.speciesId : '',
      detail: evolution ? `进化条件：EXP ${evolution.xp} + ${evolution.gold} 金币${evolution.requiresTraining ? ' + 特训法' : ''}。` : '',
    });
  }
  if (unit.kind === 'logistics' && unit.role !== 'builder' && unit.role !== 'trader') {
    const reason = foundingReason(view, unit);
    actions.push({
      id: 'found-city', action: 'found', icon: 'found', label: '建城', hotkey: 'B', key: UNIT_BAR_HOTKEYS.found, tone: 'primary',
      title: '在此建立城市', reason: lock ?? reason, detail: '已知选址条件满足：建城消耗这支开拓队。', attention: Boolean(goTo?.arrived) && !reason,
    });
  }
  const builder = unit.kind === 'logistics' && unit.role === 'builder';
  const worker = Boolean(view.expansion?.improvements) && (builder || (unit.kind === 'pokemon' && !usesBuilders(view)));
  const yields = (kind: ImprovementId) => Object.entries(improvementYield(kind, player)).filter(([, amount]) => amount > 0)
    .map(([key, amount]) => `${({ food: '食物', production: '生产', gold: '金币', research: '科研' } as const)[key as 'food']} +${amount}`).join(' ');
  const here = hexToIndex(unit.position, view.map);
  const options: ImproveOption[] = worker ? improvementOptions(view, unit.id, content).map(option => ({ tileIndex: option.tileIndex, kind: option.kind,
    label: `${IMPROVEMENTS[option.kind].name}（${yields(option.kind)}）${option.tileIndex === here ? '' : ' · 相邻格'}${builder ? '' : ` · 进度 ${option.progress}/${IMPROVEMENT_WORK.required} +${option.points}`}` })) : [];
  if (worker) {
    actions.push({
      id: 'improve-unit', action: 'improve', icon: 'improve', label: builder ? '改良' : '施工', hotkey: 'I', key: UNIT_BAR_HOTKEYS.improve,
      title: builder ? '地块改良' : '施工改良',
      reason: lock ?? (options.length ? null : unit.actionLeft ? '移到己方领地内的非城市地块（渔场可在相邻陆地施工）即可改良。' : '本回合行动点已用完。'),
      detail: options.length > 1 ? `可选：${options.map(option => option.label).join('；')}` : options[0]?.label
        ?? (builder ? lockedImprovementHints(view, unit.id, content).map(hint => `研究「${techOf(content, hint.tech as TechId).name}」后可建${IMPROVEMENTS[hint.kind].name}`).join('；') : ''),
    });
  }
  // v23: pillage (Pokémon on an enemy improvement at war) and repair (builders on damaged own improvements).
  if (usesImprovementsV23(view) && unit.kind === 'pokemon') {
    const pillage = viewPillage(view, unit.id);
    actions.push({
      id: 'pillage-unit', action: 'pillage', icon: 'pillage', label: '掠夺', hotkey: 'P', key: UNIT_BAR_HOTKEYS.pillage, tone: 'attack',
      title: '掠夺改良', reason: blocked(pillage ? null : '站在交战中敌方领地内、完好的改良上才能掠夺。'),
      detail: pillage ? `掠夺${IMPROVEMENTS[pillage.kind].name}：${pillageRewardLabel(pillage.reward)}；改良损坏，直到对方工匠修复。` : '掠夺花掉这只宝可梦本回合的行动。',
    });
  }
  if (usesImprovementsV23(view) && builder) {
    const repairs = viewRepairs(view, unit.id, content);
    actions.push({
      id: 'repair-unit', action: 'repair', icon: 'repair', label: '修复', hotkey: 'X', key: UNIT_BAR_HOTKEYS.repair, data: repairs.length ? String(repairs[0]) : '',
      title: '修复改良', reason: blocked(repairs.length ? null : '站到己方领地内损坏的改良上（海上改良站在相邻陆地）。'),
      detail: '修复花掉本回合行动，不消耗工匠次数（随行「巧手」不占行动）。',
    });
  }
  // v24 B: a Pokémon standing on a circuit gym can open the challenge card.
  const gym = gymBarState(view, unit);
  if (gym) actions.push({
    id: 'gym-unit', action: 'gym', icon: 'gym', label: '道馆', hotkey: 'G', key: UNIT_BAR_HOTKEYS.gym, tone: 'primary',
    title: `挑战道馆 · ${gymTitle(gym.gym)}`, reason: lock ?? gym.reason,
    detail: contentForView(view).teamBattles ? `单打接力：带与馆主同数的宝可梦（2 格内），自己选人和出场顺序。你的下一位馆主：${nextLeaderText(view)}。`
      : `带上 2 格内最多 3 只宝可梦。你的下一位馆主：${nextLeaderText(view)}。`,
  });
  // v26 P3: a Pokémon in reach of the own rival's team can open the duel picker (who, the order, the stake).
  if (unit.kind === 'pokemon' && content.rivalDuels && viewDuelCandidates(view).candidates.includes(unit.id)) {
    const spec = rivalDuelSpec(view, content);
    actions.push({
      id: 'duel-unit', action: 'duel', icon: 'attack', label: '对决', hotkey: 'D', key: UNIT_BAR_HOTKEYS.duel, tone: 'primary',
      title: `劲敌对决 · ${view.expansion?.rivals?.name ?? ''}`, reason: lock ?? (spec ? null : '劲敌这次登场的宝可梦要全部在视野里，且你有同样多只在 2 格内的宝可梦（每轮一次）。'),
      detail: '单打接力：带与在场劲敌同样多的宝可梦，选切磋（一半奖励，劲敌不走）或真剑（全额奖励，输了付奖金）。',
    });
  }
  const others = view.units.some(other => other.ownerId === view.playerId && other.actionLeft && other.id !== unit.id);
  actions.push({
    id: 'skip-unit', action: 'skip', icon: 'skip', label: '跳过', hotkey: '空格', key: UNIT_BAR_HOTKEYS.skip,
    title: '跳过 · 下一个单位', reason: others ? null : '没有其他待命单位。', detail: '本单位保持待命，选中下一个待命单位。',
  });
  return { actions, options };
}

let rendered = '';
let lastView: PlayerView | null = null;
let current: { callbacks: UnitBarCallbacks; options: ImproveOption[]; unitId: number | null } = { callbacks: null!, options: [], unitId: null };
let menuOpen = false;

/** Renders the bar for the selected own unit (hidden otherwise); `lock` disables every order with its reason. */
export function renderUnitActionBar(view: PlayerView, selected: number | null, mode: ActionMode, lock: string | null, callbacks: UnitBarCallbacks, goTo: UnitBarGoTo | null = null): void {
  const root = document.querySelector<HTMLElement>('#unit-action-bar');
  if (!root) return;
  const unit = view.units.find(candidate => candidate.id === selected && candidate.ownerId === view.playerId);
  if (unit?.id !== current.unitId) menuOpen = false;
  current = { callbacks, options: [], unitId: unit?.id ?? null };
  refreshGymCard(view, unit?.id ?? null, lock !== null);
  refreshLineupPicker(view);
  lastView = view;
  if (!unit) { root.hidden = true; if (rendered) { root.innerHTML = ''; rendered = ''; } return; }
  const { actions, options } = barActions(view, unit, mode, lock, callbacks.goTo ? goTo ?? { mode: false, turns: null, arrived: false } : null);
  current.options = options;
  if (menuOpen && (lock || options.length < 2)) menuOpen = false;
  const name = unitDefinition(unit, contentForView(view)).name;
  const markup = `<span class="unit-action-name">${escapeHtml(name)}</span>${actions.map(item => `<span class="unit-action-slot">
    <button type="button" id="${item.id}" class="unit-action${item.selected ? ' selected' : ''}${item.tone ? ` ${item.tone}` : ''}${item.attention ? ' attention' : ''}" data-action="${item.action}" data-hotkey="${escapeHtml(item.key)}"${item.data ? ` data-species="${item.data}"` : ''}
      aria-label="${escapeHtml(item.title)}" aria-keyshortcuts="${item.key === ' ' ? 'Space' : item.key === 'backspace' ? 'Backspace' : item.hotkey}" aria-describedby="${item.id}-tip"${item.selected ? ' aria-pressed="true"' : ''}
      title="${escapeHtml(item.reason ? `${item.title}：${item.reason}` : `${item.title}（${item.hotkey}）`)}"${item.reason ? ` data-reason="${escapeHtml(item.reason)}" disabled` : ''}>
      <span class="unit-action-icon">${item.kit ? uiIcon(item.kit, { size: 18 }) : ICONS[item.icon!]}</span><span class="unit-action-label">${item.label}</span><kbd>${item.hotkey}</kbd>${item.count !== undefined ? `<span class="unit-action-count${item.count ? '' : ' empty'}" aria-hidden="true">${item.count}</span>` : ''}</button>
    <span class="unit-action-tip${item.reason ? ' unavailable' : ''}" id="${item.id}-tip" role="tooltip"><b>${escapeHtml(item.title)} <kbd>${item.hotkey}</kbd></b>${item.reason ? `<span class="unit-action-reason">${escapeHtml(item.reason)}</span>` : ''}${item.detail ? `<small>${escapeHtml(item.detail)}</small>` : ''}</span>
    ${item.action === 'improve' && menuOpen ? `<span class="unit-action-menu" role="menu" aria-label="选择改良">${options.map(option => `<button type="button" role="menuitem" data-action="improve-option" data-tile="${option.tileIndex}" data-kind="${option.kind}">${escapeHtml(option.label)}</button>`).join('')}</span>` : ''}
  </span>`).join('')}`;
  root.hidden = false;
  if (markup !== rendered) { root.innerHTML = markup; rendered = markup; }
}

function run(button: HTMLButtonElement) {
  const { callbacks, options } = current;
  switch (button.dataset.action) {
    case 'move': case 'attack': case 'capture': {
      const mode = button.dataset.action as Exclude<ActionMode, null>;
      callbacks.mode(button.classList.contains('selected') ? null : mode); return;
    }
    case 'evolve': callbacks.evolve((button.dataset.species || undefined) as SpeciesId | undefined); return;
    case 'found': callbacks.found(); return;
    case 'improve':
      if (options.length === 1) { menuOpen = false; callbacks.improve(options[0].tileIndex, options[0].kind); return; }
      menuOpen = !menuOpen; rendered = ''; callbacks.explain(menuOpen ? '选择要建造的改良。' : '');
      if (menuOpen) document.querySelector<HTMLButtonElement>('#unit-action-bar [data-action="improve-option"]')?.focus();
      return;
    case 'improve-option': menuOpen = false; callbacks.improve(Number(button.dataset.tile), button.dataset.kind as ImprovementId); return;
    case 'pillage': if (current.unitId !== null) callbacks.order?.({ type: 'PillageImprovement', unitId: current.unitId }); return;
    case 'repair': if (current.unitId !== null && button.dataset.species) callbacks.order?.({ type: 'RepairImprovement', unitId: current.unitId, tileIndex: Number(button.dataset.species) }); return;
    case 'gym': {
      if (current.unitId === null || !lastView || !callbacks.order) return;
      // v26: the lineup picker (who goes, in which order, the matchup grid and the estimate) replaces the power-ratio card.
      const gym = gymBarState(lastView, lastView.units.find(item => item.id === current.unitId)!);
      if (gym && contentForView(lastView).teamBattles) openLineupPicker(lastView, { kind: 'gym', key: String(gym.gym.id) }, callbacks.order);
      else openGymCard(lastView, current.unitId, callbacks.order);
      return;
    }
    case 'duel': if (lastView && callbacks.order) openLineupPicker(lastView, { kind: 'rival', key: '' }, callbacks.order); return;
    case 'goto': callbacks.goTo?.(); return;
    case 'cancel-goto': callbacks.cancelGoTo?.(); return;
    case 'skip': callbacks.skip(); return;
  }
}

/** Click delegation, hotkeys, and the bar's offset above the end-turn block. Call once. */
export function installUnitActionBar(): void {
  const root = document.querySelector<HTMLElement>('#unit-action-bar');
  if (!root) return;
  // Keep keyboard focus on the map when a bar button is clicked, so Space / hotkeys keep working.
  root.addEventListener('mousedown', event => { if ((event.target as HTMLElement).closest('button')) event.preventDefault(); });
  root.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    if (button && !button.disabled && current.callbacks) run(button);
  });
  document.addEventListener('keydown', event => {
    if (root.hidden || !current.callbacks || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
    const target = event.target as HTMLElement | null;
    if (target?.matches('input, select, textarea, [contenteditable="true"]')) return;
    if (document.querySelector('dialog[open]') || !document.querySelector<HTMLElement>('#screen-host')?.hidden) return;
    if (event.key === 'Escape' && menuOpen) { menuOpen = false; rendered = ''; current.callbacks.explain(''); return; }
    const key = event.key.toLowerCase();
    // Space (and Backspace) keep their native meaning on any focused control (bar buttons and the improvement menu included); skip uses it from the map.
    if ((key === ' ' || key === 'backspace') && target?.matches('button, a, summary, [role="button"], [role="menuitem"]')) return;
    const button = [...root.querySelectorAll<HTMLButtonElement>('button[data-hotkey]')].find(candidate => candidate.dataset.hotkey === key);
    if (!button) return;
    event.preventDefault();
    if (button.disabled) current.callbacks.explain(`${button.getAttribute('aria-label')}不可用：${button.dataset.reason ?? ''}`);
    else run(button);
  });
  const stage = root.closest<HTMLElement>('.stage'), block = stage?.querySelector<HTMLElement>('.turn-block');
  if (stage && block) new ResizeObserver(() => { stage.style.setProperty('--turn-block-h', `${block.offsetHeight}px`); stage.style.setProperty('--turn-block-w', `${block.offsetWidth}px`); }).observe(block);
}
