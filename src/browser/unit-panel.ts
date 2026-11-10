import { isEmbarked } from '../core/terrain.ts';
import { strengthMarkup } from './strength-panel.ts';
import { captureBlocker, evolutionState, foundingReason } from './unit-action-bar.ts';
import { classModifierLabels, hasAffinity, usesUnitClasses } from '../core/unit-classes.ts';
import { CLASS_COUNTERS, CLASS_IDS, CLASS_NAMES, CLASS_NATIVE_TYPES } from '../content/unit-classes.ts';
import { ROLE_POKEMON, BUILDER_RULES } from '../content/roles.ts';
import { usesBuilders, usesImprovementsV23 } from '../core/improvements.ts';
import { tradeDestinations } from '../core/city-network.ts';
import { ESCORT_BONUSES, escortBonusKind } from '../content/city-network.ts';
import type { MapUnit } from '../core/model.ts';
import type { Content } from '../content/units.ts';
import { movementBudget, usesMovementPoints } from '../core/movement.ts';
import type { SpeciesId } from '../content/species.ts';
import { EVOLUTION_BLOCKER_TEXT, evolutionBlocker } from '../core/roster.ts';
import { promotionMarkup } from './promotion-panel.ts';
import { promotionMovement } from '../core/promotions.ts';
import { ERA_ABILITIES, ERA_ABILITY_RULES } from '../content/era-abilities.ts';
import { canMega, primaryEssence } from '../core/era-abilities.ts';
import { TYPE_ESSENCE } from '../content/essences.ts';
import { TYPE_NAMES } from '../content/type-names.ts';
import type { TypeId } from '../content/species.ts';
import { identityEssences } from '../core/essences.ts';
import { ESSENCES } from '../content/essences.ts';
const BIOME_LABEL = { grassland: '草原', forest: '森林', mountain: '山地', ocean: '海洋', desert: '荒漠', snow: '雪原', volcano: '火山' } as const;
import { doctrineEffects } from '../core/leader-doctrines.ts';
import { ROLE_CITY_ASSAULT } from '../core/role-tactics.ts';
import { improvementOptions, improvementYield } from '../core/improvements.ts';
import { exertsZoc, ignoresZoc, usesTactics } from '../core/tactics.ts';
import { CREW_SPECIALTIES, IMPROVEMENT_WORK, IMPROVEMENTS, crewSpecialtyFor } from '../content/improvements.ts';
import { pillageRewardLabel, viewPillage, viewRepairs } from '../core/pillage.ts';
import type { ImprovementId } from '../content/improvements.ts';
import { unitDefinition, contentForView } from '../content/units.ts';
import type { BallId } from '../content/economy.ts';
import type { Command, CombatTarget, PlayerView } from '../core/model.ts';
import { previewAttack, previewCapture } from '../core/preview.ts';
import { pokemonSpritePath } from './sprites.ts';
import { WORLD_DEFINITIONS } from '../content/world-systems.ts';

export type ActionMode = 'move' | 'attack' | 'capture' | null;
export type PendingTarget = CombatTarget & { index: number };
type Callbacks = {
  mode: (mode: ActionMode) => void;
  confirm: () => void;
  cancel: () => void;
  evolve: (intoSpeciesId?: SpeciesId) => void;
  ball: (ballId: BallId) => void;
  found: () => void;
  improve?: (tileIndex: number, kind: ImprovementId) => void;
  issue?: (action: Command['action']) => void;
};

/** v16: remaining movement points (a unit can still attack while it has any); older rules: one action per round. */
function actionPointLabel(view: PlayerView, unit: MapUnit, content: Content): string {
  // v24 A2: a land unit carried on water.
  const embarked = isEmbarked(unit, view.map, content) ? ' · 乘浪中：防守 −10，不能攻击' : '';
  return actionPoints(view, unit, content) + embarked;
}
function actionPoints(view: PlayerView, unit: MapUnit, content: Content): string {
  if (!usesMovementPoints(view)) return `行动点 ${unit.actionLeft}`;
  if (!unit.actionLeft) return '本轮已行动';
  const budget = movementBudget(view, unit, content);
  return `移动 ${Math.max(0, budget - (unit.movesSpent ?? 0))}/${budget}`;
}
/** v19: the unit's class, what it counters, what counters it, and type affinity. */
function classNoteMarkup(view: PlayerView, unit: MapUnit, content: Content): string {
  if (!usesUnitClasses(view) || unit.kind !== 'pokemon') return '';
  const role = content.species[unit.speciesId].role, beatenBy = CLASS_IDS.filter(other => CLASS_COUNTERS[other].beats.includes(role));
  return `<p class="unit-note" id="class-note">兵种「${CLASS_NAMES[role]}」：${CLASS_COUNTERS[role].beats.length ? `克制${CLASS_COUNTERS[role].beats.map(other => CLASS_NAMES[other]).join('、')}（${content.combat === 'strength' ? '战斗力 +5' : '×1.2'}）` : CLASS_COUNTERS[role].note}${beatenBy.length ? `；怕${beatenBy.map(other => CLASS_NAMES[other]).join('、')}` : ''}${hasAffinity(unit, content) ? (content.combat === 'strength' ? '；<b>属性契合</b>，战斗力 +3' : '；<b>属性契合</b>，伤害 +15%') : `；契合属性：${CLASS_NATIVE_TYPES[role].map(type => TYPE_NAMES[type]).join('、')}`}</p>`;
}
export function renderUnitPanel(view: PlayerView, selected: number | null, mode: ActionMode,
  target: PendingTarget | null, ballId: BallId, busy: boolean, callbacks: Callbacks,
  /** The single-player client shows move / attack / capture / evolve / found in the unit action bar instead. */
  panelOptions: { actionsInBar?: boolean } = {}): void {
  const inBar = panelOptions.actionsInBar === true;
  const CONTENT = contentForView(view);
  const root = document.querySelector<HTMLElement>('#unit-panel')!;
  const unit = view.units.find(unit => unit.id === selected && unit.ownerId === view.playerId);
  if (!unit) { root.innerHTML = ''; return; }
  if (unit.kind === 'logistics' && unit.role === 'builder') {
    const options = view.expansion?.improvements ? improvementOptions(view, unit.id, CONTENT) : [];
    const repairs = viewRepairs(view, unit.id, CONTENT);
    const yieldText = (kind: ImprovementId) => Object.entries(improvementYield(kind, view.economy.player)).filter(([, amount]) => amount > 0)
      .map(([key, amount]) => `${({ food: '食', production: '产', gold: '金', research: '研' } as const)[key as 'food']}+${amount}`).join(' ');
    root.innerHTML = `<div class="unit-card builder-card"><div class="unit-head"><div class="unit-portrait"><img src="${ROLE_POKEMON.builder.sprite}" alt="${ROLE_POKEMON.builder.species}" width="64" height="64"></div><div><strong>工匠 · ${ROLE_POKEMON.builder.species}</strong><small>地块改良 · 剩余 ${unit.charges ?? 0} 次 · 文明 ${view.playerId + 1}</small></div><span class="unit-ap ${unit.actionLeft ? '' : 'spent'}">${actionPointLabel(view, unit, CONTENT)}</span></div>
      <p class="settler-intro">站到己方领地内的地块上（渔场可在相邻陆地施工），一次行动就建好一处改良。每个工匠能建 ${BUILDER_RULES.charges} 处，用完后离开。没有战斗力，被攻击会直接被打散。</p>
      ${unit.escortId && usesImprovementsV23(view) ? `<p class="unit-note" id="crew-note">随行：${CONTENT.species[unit.escortId].name} · 特长「${CREW_SPECIALTIES[crewSpecialtyFor(CONTENT.species[unit.escortId].typeId)].name}」：${CREW_SPECIALTIES[crewSpecialtyFor(CONTENT.species[unit.escortId].typeId)].label}（记在建成的地块上）</p>` : ''}
      ${repairs.length ? `<section class="improvement-box" id="repair-box" aria-label="修复改良">${repairs.map(tileIndex => `<button type="button" data-repair="${tileIndex}" ${busy ? 'disabled' : ''}>修复${IMPROVEMENTS[view.expansion!.improvements!.tiles.find(tile => tile.tileIndex === tileIndex)!.kind].name}（不消耗次数）</button>`).join('')}</section>` : ''}
      <section class="improvement-box" id="improvement-box" aria-label="地块改良">${options.length
        ? options.map(option => `<button type="button" data-improve="${option.tileIndex}:${option.kind}" ${busy ? 'disabled' : ''}>${IMPROVEMENTS[option.kind].name}（${yieldText(option.kind)}）</button>`).join('')
        : `<p class="unit-note">${unit.actionLeft ? '移到己方领地内的非城市地块（渔场可在相邻陆地施工）即可改良。' : '本回合行动点已用完。'}</p>`}</section>
      ${inBar ? '' : `<div class="unit-actions"><button id="move-unit" ${busy || !unit.actionLeft ? 'disabled' : ''}>${mode === 'move' ? '取消移动' : '移动'}</button></div>`}</div>`;
    root.querySelector('#move-unit')?.addEventListener('click', () => callbacks.mode(mode === 'move' ? null : 'move'));
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-improve]')) button.addEventListener('click', () => {
      const [tile, kind] = button.dataset.improve!.split(':');
      callbacks.improve?.(Number(tile), kind as ImprovementId);
    });
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-repair]')) button.addEventListener('click', () => callbacks.issue?.({ type: 'RepairImprovement', unitId: unit.id, tileIndex: Number(button.dataset.repair) }));
    return;
  }
  if (unit.kind === 'logistics' && unit.role === 'trader') {
    const destinations = tradeDestinations(view, unit.id);
    root.innerHTML = `<div class="unit-card trader-card"><div class="unit-head"><div class="unit-portrait"><img src="${ROLE_POKEMON.trader.sprite}" alt="${ROLE_POKEMON.trader.species}" width="64" height="64"></div><div><strong>商队 · ${ROLE_POKEMON.trader.species}</strong><small>出发城市 ${unit.homeCityId ?? '—'} · 文明 ${view.playerId + 1}</small></div><span class="unit-ap ${unit.actionLeft ? '' : 'spent'}">${actionPointLabel(view, unit, CONTENT)}</span></div>
      <p class="settler-intro">走到另一座己方城市旁边，开通商路：目的城 食物 +2、生产 +1，出发城 金币 +3，一直有效（城市易主则中断）。路上被敌人攻击会被打散。</p>
      <ul class="trade-destinations">${destinations.map(item => `<li><button type="button" data-trade-route="${item.cityId}" ${busy || item.reason ? 'disabled' : ''}>通往城市 ${item.cityId}</button>${item.reason ? `<small>${item.reason}</small>` : ''}</li>`).join('') || '<li><small>还没有别的己方城市。</small></li>'}</ul>
      ${inBar ? '' : `<div class="unit-actions"><button id="move-unit" ${busy || !unit.actionLeft ? 'disabled' : ''}>${mode === 'move' ? '取消移动' : '移动'}</button></div>`}</div>`;
    root.querySelector('#move-unit')?.addEventListener('click', () => callbacks.mode(mode === 'move' ? null : 'move'));
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-trade-route]')) button.addEventListener('click', () => callbacks.issue?.({ type: 'EstablishTradeRoute', unitId: unit.id, toCityId: Number(button.dataset.tradeRoute) }));
    return;
  }
  if (unit.kind === 'logistics') {
    const reason = foundingReason(view, unit);
    root.innerHTML = `<div class="unit-card settler-card"><div class="unit-head"><div class="unit-portrait settler-portrait"><img src="${ROLE_POKEMON.settler.sprite}" alt="${ROLE_POKEMON.settler.species}" width="64" height="64"></div><div><strong>开拓队 · ${ROLE_POKEMON.settler.species}</strong><small>建立城市 · 文明 ${view.playerId + 1}</small></div><span class="unit-ap ${unit.actionLeft ? '' : 'spent'}">${actionPointLabel(view, unit, CONTENT)}</span></div>
      <p class="settler-intro">在新的土地上建立一座人口为 1 的城市。</p>
      ${unit.escortId ? `<p class="unit-note" id="escort-note">随行：${CONTENT.species[unit.escortId].name} · 建城时 ${ESCORT_BONUSES[escortBonusKind(CONTENT.species[unit.escortId].typeId)].label}</p>` : ''}
      <ol class="founding-steps"><li>移动到陆地，与其他城市至少相距 4 格。</li><li>${usesMovementPoints(view) ? '移动消耗移动力；还有移动力就能当回合建城。' : '移动会消耗行动点；下一回合再建城。'}</li><li>建城消耗这支开拓队，随后进入城市管理。</li></ol>
      <p id="founding-status" class="founding-status ${reason ? 'unavailable' : ''}">${reason ?? '已知选址条件满足，可以在此建立城市。'}</p>
      ${inBar ? '' : `<div class="unit-actions"><button id="move-unit" ${busy || !unit.actionLeft ? 'disabled' : ''}>${mode === 'move' ? '取消移动' : '移动'}</button><button id="found-city" class="primary" ${busy || reason ? 'disabled' : ''}>在此建立城市</button></div>`}
      <p class="unit-note">需要更多开拓队：选中城市 → 训练开拓队 → 加入队列（${contentForView(view).units.settler.trainCost} 生产）。</p></div>`;
    root.querySelector('#found-city')?.addEventListener('click', callbacks.found);
    root.querySelector('#move-unit')?.addEventListener('click', () => callbacks.mode(mode === 'move' ? null : 'move'));
    return;
  }
  const definition = unitDefinition(unit, CONTENT), species = CONTENT.species[unit.speciesId];
  const player = view.economy.player;
  const { evolution, stoneEvolution, canEvolve, blocker: evolutionNote, branches, branchContext, branchReady, candyPrice } = evolutionState(view, unit, CONTENT);
  const otherBranches = branches.filter(option => option.speciesId !== evolution?.speciesId);
  const branchMarkup = otherBranches.length ? `<div class="evolution-branches" id="evolution-branches"><p class="section-label">其他进化方向</p>${otherBranches.map(option => {
    const blocker = evolutionBlocker(CONTENT, option, branchContext);
    return `<button type="button" data-evolve="${option.speciesId}" title="${blocker ? EVOLUTION_BLOCKER_TEXT[blocker] : `EXP ${option.xp} + ${option.gold} 金币`}" ${busy || !unit.actionLeft || !branchReady(option) ? 'disabled' : ''}>进化→${CONTENT.species[option.speciesId].name}${blocker ? `（${EVOLUTION_BLOCKER_TEXT[blocker]}）` : ''}</button>`;
  }).join('')}</div>` : '';
  const canCapture = captureBlocker(view) === null;
  const targetUnit = target?.kind === 'unit' ? view.units.find(unit => unit.id === target.id) : null;
  const targetLabel = targetUnit
    ? targetUnit.kind === 'pokemon' ? CONTENT.species[targetUnit.speciesId].name : '开拓队'
    : target ? `城市 ${target.id}` : null;
  const attackPreview = mode === 'attack' && target ? previewAttack(view, unit.id, { kind: target.kind, id: target.id }) : null;
  const capturePreview = mode === 'capture' && target ? previewCapture(view, unit.id, target.id, ballId) : null;
  const reasonText = (reason: string) => ({ 'at-peace': '未处于战争状态', 'out-of-range': '超出射程', 'attack-unavailable': '当前不可攻击', 'capture-unavailable': '当前不可捕捉' })[reason] ?? reason;
  const attackText = attackPreview
    ? attackPreview.ok
      ? `预计伤害 ${attackPreview.damage.min}–${attackPreview.damage.max}；${attackPreview.counter.trigger === 'never' ? '无反击' : `${attackPreview.counter.trigger === 'always' ? '预计反击' : '可能反击'} ${attackPreview.counter.damage}`}；击坠：${attackPreview.knockdown === 'guaranteed' ? '必定' : attackPreview.knockdown === 'possible' ? '可能' : '无'}${attackPreview.strength ? '' : classModifierLabels(view, unit, targetUnit ?? null, CONTENT).map(label => `；${label}`).join('')}`
      : `不可攻击：${reasonText(attackPreview.reason)}`
    : '选择红色虚线目标查看伤害、反击与击坠。';
  const captureText = capturePreview
    ? capturePreview.ok ? `捕捉成功率 ${capturePreview.probability}%；使用${ballId === 'greatBall' ? '超级球' : '精灵球'}。`
      : `不可捕捉：${reasonText(capturePreview.reason)}`
    : '选择野生宝可梦查看成功率。';
  const preview = mode === 'attack'
    ? `<div class="combat-preview"><p class="eyebrow">战斗结算预览</p><strong>${targetLabel ?? '未选择目标'}</strong><p id="battle-preview">${attackText}</p>${attackPreview?.ok && attackPreview.strength ? strengthMarkup(attackPreview.strength, definition.name, targetLabel ?? '目标') : ''}</div>`
    : mode === 'capture'
      ? `<div class="combat-preview"><p class="eyebrow">捕捉预览</p><strong>${targetLabel ?? '未选择目标'}</strong><p id="capture-preview">${captureText}</p></div>`
      : '';
  const yieldLabel = (kind: ImprovementId) => Object.entries(improvementYield(kind, player)).filter(([, amount]) => amount > 0)
    .map(([key, amount]) => `${({ food: '食', production: '产', gold: '金', research: '研' } as const)[key as 'food']}+${amount}`).join(' ');
  const options = view.expansion?.improvements ? improvementOptions(view, unit.id, CONTENT) : [];
  const improvementMarkup = view.expansion?.improvements && !usesBuilders(view) ? `<section class="improvement-box" id="improvement-box" aria-label="地块改良"><p class="section-label">地块改良 · 己方领地内，${IMPROVEMENT_WORK.required} 点完工（熟练属性每次 ${IMPROVEMENT_WORK.crew} 点，其他 ${IMPROVEMENT_WORK.other} 点）</p>${options.length
    ? options.map(option => `<button type="button" data-improve="${option.tileIndex}:${option.kind}" ${busy ? 'disabled' : ''}>${IMPROVEMENTS[option.kind].name}（${yieldLabel(option.kind)}）· 进度 ${option.progress}/${IMPROVEMENT_WORK.required} +${option.points}</button>`).join('')
    : `<p class="unit-note">${unit.actionLeft ? '移到己方领地内的非城市地块（渔场可在相邻陆地施工）即可改良。' : '本回合行动点已用完。'}</p>`}</section>` : '';
  // v23: pillage lives in the action bar in single player; the drawer (multiplayer) shows it here.
  const pillage = inBar ? null : viewPillage(view, unit.id);
  const pillageMarkup = pillage ? `<section class="improvement-box" id="pillage-box" aria-label="掠夺改良"><button type="button" id="pillage-unit" ${busy ? 'disabled' : ''}>掠夺${IMPROVEMENTS[pillage.kind].name}（${pillageRewardLabel(pillage.reward)}）</button></section>` : '';
  const era = view.expansion?.eraAbilities, stock = view.expansion?.essences?.stock;
  const essence = era && stock ? primaryEssence(unit, CONTENT) : null;
  const status = era?.units[unit.id] ?? {};
  const eraButtons: string[] = [];
  const eraButton = (label: string, action: Command['action'], enabled: boolean, title: string) =>
    eraButtons.push(`<button type="button" data-era-action='${JSON.stringify(action)}' title="${title}" ${busy || !enabled ? 'disabled' : ''}>${label}</button>`);
  if (era && stock && essence) {
    const has = (cost: number) => stock[essence] >= cost;
    const name = `${ESSENCES[essence].name}（有 ${stock[essence]}）`;
    if (era.unlocked.includes('mega') && canMega(unit, CONTENT)) eraButton(status.mega ? 'Mega 已激活' : `Mega 进化 · ${ERA_ABILITY_RULES.megaCost} ${name}`, { type: 'MegaEvolve', unitId: unit.id }, !status.mega && (era.own.megaUnitId === null) && has(ERA_ABILITY_RULES.megaCost), ERA_ABILITIES.mega.description);
    if (era.unlocked.includes('zMove')) eraButton(status.zPrimed ? 'Z 招式待发' : `Z 招式 · ${ERA_ABILITY_RULES.zCost} ${name}${view.round < era.own.zReadyAtRound ? ` · 第 ${era.own.zReadyAtRound} 轮` : ''}`, { type: 'PrimeZMove', unitId: unit.id }, !status.zPrimed && view.round >= era.own.zReadyAtRound && has(ERA_ABILITY_RULES.zCost), ERA_ABILITIES.zMove.description);
    if (era.unlocked.includes('dynamax')) eraButton((status.dynamaxUntilRound ?? 0) >= view.round ? `极巨化至第 ${status.dynamaxUntilRound} 轮` : `极巨化 · ${ERA_ABILITY_RULES.dynamaxCost} ${name}${view.round < era.own.dynamaxReadyAtRound ? ` · 第 ${era.own.dynamaxReadyAtRound} 轮` : ''}`, { type: 'Dynamax', unitId: unit.id }, (status.dynamaxUntilRound ?? 0) < view.round && view.round >= era.own.dynamaxReadyAtRound && has(ERA_ABILITY_RULES.dynamaxCost), ERA_ABILITIES.dynamax.description);
  }
  const teraOptions = era && stock && era.unlocked.includes('tera') && !status.tera && era.own.teraUnitId === null
    ? (Object.keys(TYPE_ESSENCE) as TypeId[]).filter(type => stock[TYPE_ESSENCE[type]] >= ERA_ABILITY_RULES.teraCost) : [];
  const eraMarkup = era ? `<section class="era-ability-box" id="era-ability-box"><p class="section-label">时代能力 · 第 ${era.generation} 世代${era.night ? ' · 夜晚' : ' · 白天'}</p>
    ${eraButtons.length ? `<div class="era-ability-actions">${eraButtons.join('')}</div>` : ''}
    ${status.tera ? `<p class="unit-note">太晶属性：${TYPE_NAMES[status.tera]}</p>` : teraOptions.length ? `<div class="tera-row"><select id="tera-type">${teraOptions.map(type => `<option value="${type}">${TYPE_NAMES[type]}（${ESSENCES[TYPE_ESSENCE[type]].name}）</option>`).join('')}</select><button type="button" id="terastallize" ${busy ? 'disabled' : ''} title="${ERA_ABILITIES.tera.description}">太晶化 · ${ERA_ABILITY_RULES.teraCost}</button></div>` : ''}
    ${essence && stock && eraButtons.length ? `<p class="unit-note">消耗本属性精华「${ESSENCES[essence].name}」，来自${ESSENCES[essence].biome === 'ocean' ? '海洋' : ({ grassland: '草原', forest: '森林', mountain: '山地', desert: '荒漠', snow: '雪原', volcano: '火山' } as Record<string, string>)[ESSENCES[essence].biome]}地块；城市耕作对应地形即可积累。</p>` : ''}
    ${!eraButtons.length && !teraOptions.length && !status.tera ? `<p class="unit-note">${era.unlocked.length ? '本单位暂无可用时代能力。' : '进入金银时代后解锁昼夜，宝石时代解锁天气；完整世代模式还有 Mega、Z 招式、极巨化与太晶化。'}</p>` : ''}</section>` : '';
  root.innerHTML = `<div class="unit-card"><div class="unit-head"><div class="unit-portrait"><img src="${pokemonSpritePath(unit.speciesId)}" alt="${definition.name}" width="64" height="64"></div><div><strong>${definition.name}</strong><small>宝可梦 · 文明 ${view.playerId + 1}${unit.enraged ? ' · 激怒' : ''}</small></div><span class="unit-ap ${unit.actionLeft ? '' : 'spent'}">${actionPointLabel(view, unit, CONTENT)}</span></div>
    <div class="unit-vitals"><span>HP <strong>${unit.hp}/${species.maxHp}</strong><span class="vital-bar" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, unit.hp * 100 / species.maxHp))}%"></span></span></span><span>EXP <strong>${unit.xp}${evolution ? `/${evolution.xp}` : ''}</strong>${evolution ? `<span class="vital-bar xp" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, unit.xp * 100 / evolution.xp))}%"></span></span>` : ''}</span></div>
    <div class="unit-details"><div class="unit-detail"><small>${CONTENT.combat === 'strength' ? '攻击战斗力' : '攻击'}</small><strong>${species.attack}</strong></div><div class="unit-detail"><small>${CONTENT.combat === 'strength' ? '防御战斗力' : '防御'}</small><strong>${species.defense}</strong></div><div class="unit-detail"><small>射程</small><strong>${species.range}</strong></div><div class="unit-detail"><small>移动</small><strong>${species.move + doctrineEffects(player, view.eraProgression, unit, CONTENT).movementBonus + promotionMovement(view, unit.id)}</strong></div><div class="unit-detail"><small>视野</small><strong>${species.vision}</strong></div>${CONTENT.combat === 'strength' ? '' : `<div class="unit-detail"><small>威力</small><strong>${species.power}</strong></div>`}</div>
    ${classNoteMarkup(view, unit, CONTENT)}
    ${view.gameplayVersion ? `<p class="unit-note" id="assault-role">兵种：${ROLE_CITY_ASSAULT[species.role].label} · ${ROLE_CITY_ASSAULT[species.role].note}${doctrineEffects(player, view.eraProgression, unit, CONTENT).cityDamageBonus ? `；领袖战术再 +${doctrineEffects(player, view.eraProgression, unit, CONTENT).cityDamageBonus / 10}%` : ''}</p>` : ''}
    ${inBar ? '' : `<div class="unit-actions"><button id="move-unit" class="${mode === 'move' ? 'selected' : ''}" ${busy || !unit.actionLeft ? 'disabled' : ''}>${mode === 'move' ? '取消移动' : '移动'}</button><button id="attack-unit" class="${mode === 'attack' ? 'selected' : ''}" ${busy || !unit.actionLeft ? 'disabled' : ''}>攻击</button><button id="capture-unit" class="${mode === 'capture' ? 'selected' : ''}" ${busy || !unit.actionLeft || !canCapture ? 'disabled' : ''}>捕捉</button><button id="evolve-unit" ${busy || !unit.actionLeft || !canEvolve ? 'disabled' : ''}>${evolution ? `${unit.xp < evolution.xp && candyPrice(evolution) !== null ? `神奇糖果 · ${candyPrice(evolution)} 金 → ` : '进化→'}${CONTENT.species[evolution.speciesId].name}` : '不可进化'}</button></div>`}
    ${view.expansion?.essences ? `<p class="unit-note" id="essence-note">属性精华：${identityEssences(unit, CONTENT).map(id => ESSENCES[id].name).join('、')} · 在${identityEssences(unit, CONTENT).map(id => BIOME_LABEL[ESSENCES[id].biome]).join('、')}防守时${CONTENT.combat === 'strength' ? '战斗力 +3' : '受伤 −10%'}</p>` : ''}
    ${usesTactics(view) ? `<p class="unit-note" id="zoc-note">${exertsZoc(unit, CONTENT) ? '控制区：相邻敌军移动到此即停下。' : ''}${ignoresZoc(unit, CONTENT) ? '可无视敌方控制区。' : '进入敌方近战/快速单位相邻格会停下。'}${CONTENT.combat === 'strength' ? '夹击：相邻目标的友军 1 / 2 / 3 只，战斗力 +2 / +5 / +7。' : '夹击：每只相邻目标的友军 +10% 伤害（最多 +30%）。'}</p>` : ''}
    ${promotionMarkup(view, unit.id, busy)}
    ${eraMarkup}
    ${improvementMarkup}${pillageMarkup}
    ${branchMarkup}
    ${!inBar && evolutionNote ? `<p class="unit-note" id="evolution-blocker">进化→${CONTENT.species[evolution!.speciesId].name}：${EVOLUTION_BLOCKER_TEXT[evolutionNote]}。</p>` : ''}
    ${!inBar && !canCapture ? '<p class="unit-note">捕捉需要研究「驯化」，并在城市采购精灵球。</p>' : ''}
    ${mode && mode !== 'move' ? `<div class="action-config">${mode === 'capture' ? `<label>球种<select id="capture-ball"><option value="pokeBall" ${ballId === 'pokeBall' ? 'selected' : ''}>精灵球（${view.economy.player.ballInventory.pokeBall}）</option><option value="greatBall" ${ballId === 'greatBall' ? 'selected' : ''}>超级球（${view.economy.player.ballInventory.greatBall}）</option></select></label>` : ''}<button id="cancel-action">取消目标</button></div>${preview}<div class="action-confirm"><button id="confirm-action" class="primary" ${!target || (mode === 'attack' ? attackPreview?.ok !== true : capturePreview?.ok !== true) ? 'disabled' : ''}>确认${mode === 'attack' ? '攻击' : '捕捉'}</button></div>` : ''}
    ${inBar ? '' : stoneEvolution ? `<p class="unit-note">进化需要 ${WORLD_DEFINITIONS.stones[stoneEvolution.stoneId].name} + EXP ${stoneEvolution.requiredXp}，请在「树果、进化石与满意度」中使用。</p>` : evolution ? `<p class="unit-note">进化条件：EXP ${evolution.xp} + ${evolution.gold} 金币${evolution.requiresTraining ? ' + 特训法' : ''}；经验、金币与科技条件需同时满足。</p>` : ''}</div>`;
  root.querySelector('#move-unit')?.addEventListener('click', () => callbacks.mode(mode === 'move' ? null : 'move'));
  root.querySelector('#attack-unit')?.addEventListener('click', () => callbacks.mode(mode === 'attack' ? null : 'attack'));
  root.querySelector('#capture-unit')?.addEventListener('click', () => callbacks.mode(mode === 'capture' ? null : 'capture'));
  root.querySelector('#evolve-unit')?.addEventListener('click', () => callbacks.evolve(CONTENT.roster && evolution ? evolution.speciesId : undefined));
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-evolve]')) button.addEventListener('click', () => callbacks.evolve(button.dataset.evolve as SpeciesId));
  root.querySelector('#pillage-unit')?.addEventListener('click', () => callbacks.issue?.({ type: 'PillageImprovement', unitId: unit.id }));
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-promote]')) button.addEventListener('click', () => callbacks.issue?.({ type: 'PromoteUnit', unitId: unit.id, trait: button.dataset.promote as never }));
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-era-action]')) button.addEventListener('click', () => callbacks.issue?.(JSON.parse(button.dataset.eraAction!)));
  root.querySelector('#terastallize')?.addEventListener('click', () => callbacks.issue?.({ type: 'Terastallize', unitId: unit.id, typeId: root.querySelector<HTMLSelectElement>('#tera-type')!.value as TypeId }));
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-improve]')) button.addEventListener('click', () => {
    const [tile, kind] = button.dataset.improve!.split(':');
    callbacks.improve?.(Number(tile), kind as ImprovementId);
  });
  root.querySelector('#cancel-action')?.addEventListener('click', callbacks.cancel);
  root.querySelector('#confirm-action')?.addEventListener('click', callbacks.confirm);
  root.querySelector<HTMLSelectElement>('#capture-ball')?.addEventListener('change', event => callbacks.ball((event.target as HTMLSelectElement).value as BallId));
}
