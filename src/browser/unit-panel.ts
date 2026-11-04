import type { MapUnit } from '../core/model.ts';
import type { Content } from '../content/units.ts';
import { movementBudget, usesMovementPoints } from '../core/movement.ts';
import type { SpeciesId } from '../content/species.ts';
import { stoneEvolutionsFor } from '../content/roster.ts';
import type { EvolutionOption } from '../content/species.ts';
import { EVOLUTION_BLOCKER_TEXT, evolutionBlocker, evolutionOptions, playerGeneration, tileBiome } from '../core/roster.ts';
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
import { IMPROVEMENT_WORK, IMPROVEMENTS } from '../content/improvements.ts';
import type { ImprovementId } from '../content/improvements.ts';
import { unitDefinition, contentForView } from '../content/units.ts';
import type { BallId } from '../content/economy.ts';
import type { Command, CombatTarget, PlayerView } from '../core/model.ts';
import { previewAttack, previewCapture } from '../core/preview.ts';
import { hexDistance, hexToIndex } from '../core/hex.ts';
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
  if (!usesMovementPoints(view)) return `行动点 ${unit.actionLeft}`;
  if (!unit.actionLeft) return '本轮已行动';
  const budget = movementBudget(view, unit, content);
  return `移动 ${Math.max(0, budget - (unit.movesSpent ?? 0))}/${budget}`;
}
export function renderUnitPanel(view: PlayerView, selected: number | null, mode: ActionMode,
  target: PendingTarget | null, ballId: BallId, busy: boolean, callbacks: Callbacks): void {
  const CONTENT = contentForView(view);
  const root = document.querySelector<HTMLElement>('#unit-panel')!;
  const unit = view.units.find(unit => unit.id === selected && unit.ownerId === view.playerId);
  if (!unit) { root.innerHTML = ''; return; }
  if (unit.kind === 'logistics') {
    const nearest = [...view.cities, ...Object.values(view.knowledge.lastKnownCities)]
      .reduce((distance, city) => Math.min(distance, hexDistance(unit.position, city.position)), Infinity);
    const biome = view.map.tiles[hexToIndex(unit.position, view.map)!];
    const reason = !unit.actionLeft ? '本回合已行动。结束回合后，开拓队恢复行动点。'
      : biome === 'ocean' ? '海洋上无法建城，请选择陆地。'
      : nearest < 4 ? `距最近已知城市 ${nearest} 格，至少需要 4 格。请继续向外探索。` : null;
    root.innerHTML = `<div class="unit-card settler-card"><div class="unit-head"><div class="unit-portrait settler-portrait" aria-hidden="true">⚑</div><div><strong>开拓队</strong><small>建立城市 · 文明 ${view.playerId + 1}</small></div><span class="unit-ap ${unit.actionLeft ? '' : 'spent'}">${actionPointLabel(view, unit, CONTENT)}</span></div>
      <p class="settler-intro">在新的土地上建立一座人口为 1 的城市。</p>
      <ol class="founding-steps"><li>移动到陆地，与其他城市至少相距 4 格。</li><li>移动会消耗行动点；下一回合再建城。</li><li>建城消耗这支开拓队，随后进入城市管理。</li></ol>
      <p id="founding-status" class="founding-status ${reason ? 'unavailable' : ''}">${reason ?? '已知选址条件满足，可以在此建立城市。'}</p>
      <div class="unit-actions"><button id="move-unit" ${busy || !unit.actionLeft ? 'disabled' : ''}>${mode === 'move' ? '取消移动' : '移动'}</button><button id="found-city" class="primary" ${busy || reason ? 'disabled' : ''}>在此建立城市</button></div>
      <p class="unit-note">需要更多开拓队：选中城市 → 训练开拓队 → 加入队列（30 生产）。</p></div>`;
    root.querySelector('#found-city')!.addEventListener('click', callbacks.found);
    root.querySelector('#move-unit')!.addEventListener('click', () => callbacks.mode(mode === 'move' ? null : 'move'));
    return;
  }
  const definition = unitDefinition(unit, CONTENT), species = CONTENT.species[unit.speciesId];
  const player = view.economy.player;
  const meets = (option: { xp: number; gold: number; requiresTraining: boolean }) => unit.xp >= option.xp && player.gold >= option.gold
    && (!option.requiresTraining || player.research.unlockedIds.includes('training'));
  // v14 roster: evolution branches with generation / day-night / biome conditions; stone paths stay in the world panel.
  const stonePaths = stoneEvolutionsFor(CONTENT).filter(path => path.fromSpeciesId === unit.speciesId);
  const branchContext = { generation: playerGeneration(player, view.eraProgression), round: view.round, biome: tileBiome(view, unit.position) };
  const branches = CONTENT.roster ? evolutionOptions(CONTENT, unit.speciesId).filter(option => !stonePaths.some(path => path.intoSpeciesId === option.speciesId)) : [];
  const branchReady = (option: EvolutionOption) => meets(option) && !evolutionBlocker(CONTENT, option, branchContext);
  // Main button: a branch that can evolve now, else one whose conditions hold (only EXP / gold missing), else the first.
  const evolution = CONTENT.roster ? branches.find(branchReady) ?? branches.find(option => !evolutionBlocker(CONTENT, option, branchContext)) ?? branches[0] ?? null : species.evolution;
  const stoneEvolution = view.expansion && (CONTENT.roster ? !branches.length && stonePaths[0] : WORLD_DEFINITIONS.stoneEvolutions.find(path => path.fromSpeciesId === unit.speciesId));
  const canEvolve = evolution && !stoneEvolution && (CONTENT.roster ? branchReady(evolution as EvolutionOption) : meets(evolution));
  const otherBranches = branches.filter(option => option.speciesId !== evolution?.speciesId);
  const branchMarkup = otherBranches.length ? `<div class="evolution-branches" id="evolution-branches"><p class="section-label">其他进化方向</p>${otherBranches.map(option => {
    const blocker = evolutionBlocker(CONTENT, option, branchContext);
    return `<button type="button" data-evolve="${option.speciesId}" title="${blocker ? EVOLUTION_BLOCKER_TEXT[blocker] : `EXP ${option.xp} + ${option.gold} 金币`}" ${busy || !unit.actionLeft || !branchReady(option) ? 'disabled' : ''}>进化→${CONTENT.species[option.speciesId].name}${blocker ? `（${EVOLUTION_BLOCKER_TEXT[blocker]}）` : ''}</button>`;
  }).join('')}</div>` : '';
  const evolutionNote = CONTENT.roster && evolution && !canEvolve ? evolutionBlocker(CONTENT, evolution as EvolutionOption, branchContext) : null;
  const canCapture = player.research.unlockedIds.includes('domestication')
    && (player.ballInventory.pokeBall > 0 || (player.research.unlockedIds.includes('ballCraft') && player.ballInventory.greatBall > 0));
  const targetUnit = target?.kind === 'unit' ? view.units.find(unit => unit.id === target.id) : null;
  const targetLabel = targetUnit
    ? targetUnit.kind === 'pokemon' ? CONTENT.species[targetUnit.speciesId].name : '开拓队'
    : target ? `城市 ${target.id}` : null;
  const attackPreview = mode === 'attack' && target ? previewAttack(view, unit.id, { kind: target.kind, id: target.id }) : null;
  const capturePreview = mode === 'capture' && target ? previewCapture(view, unit.id, target.id, ballId) : null;
  const reasonText = (reason: string) => ({ 'at-peace': '未处于战争状态', 'out-of-range': '超出射程', 'attack-unavailable': '当前不可攻击', 'capture-unavailable': '当前不可捕捉' })[reason] ?? reason;
  const attackText = attackPreview
    ? attackPreview.ok
      ? `预计伤害 ${attackPreview.damage.min}–${attackPreview.damage.max}；${attackPreview.counter.trigger === 'never' ? '无反击' : `${attackPreview.counter.trigger === 'always' ? '预计反击' : '可能反击'} ${attackPreview.counter.damage}`}；击坠：${attackPreview.knockdown === 'guaranteed' ? '必定' : attackPreview.knockdown === 'possible' ? '可能' : '无'}`
      : `不可攻击：${reasonText(attackPreview.reason)}`
    : '选择红色虚线目标查看伤害、反击与击坠。';
  const captureText = capturePreview
    ? capturePreview.ok ? `捕捉成功率 ${capturePreview.probability}%；使用${ballId === 'greatBall' ? '超级球' : '精灵球'}。`
      : `不可捕捉：${reasonText(capturePreview.reason)}`
    : '选择野生宝可梦查看成功率。';
  const preview = mode === 'attack'
    ? `<div class="combat-preview"><p class="eyebrow">战斗结算预览</p><strong>${targetLabel ?? '未选择目标'}</strong><p id="battle-preview">${attackText}</p></div>`
    : mode === 'capture'
      ? `<div class="combat-preview"><p class="eyebrow">捕捉预览</p><strong>${targetLabel ?? '未选择目标'}</strong><p id="capture-preview">${captureText}</p></div>`
      : '';
  const yieldLabel = (kind: ImprovementId) => Object.entries(improvementYield(kind, player)).filter(([, amount]) => amount > 0)
    .map(([key, amount]) => `${({ food: '食', production: '产', gold: '金', research: '研' } as const)[key as 'food']}+${amount}`).join(' ');
  const options = view.expansion?.improvements ? improvementOptions(view, unit.id, CONTENT) : [];
  const improvementMarkup = view.expansion?.improvements ? `<section class="improvement-box" id="improvement-box" aria-label="地块改良"><p class="section-label">地块改良 · 己方领地内，${IMPROVEMENT_WORK.required} 点完工（熟练属性每次 ${IMPROVEMENT_WORK.crew} 点，其他 ${IMPROVEMENT_WORK.other} 点）</p>${options.length
    ? options.map(option => `<button type="button" data-improve="${option.tileIndex}:${option.kind}" ${busy ? 'disabled' : ''}>${IMPROVEMENTS[option.kind].name}（${yieldLabel(option.kind)}）· 进度 ${option.progress}/${IMPROVEMENT_WORK.required} +${option.points}</button>`).join('')
    : `<p class="unit-note">${unit.actionLeft ? '移到己方领地内的非城市地块（渔场可在相邻陆地施工）即可改良。' : '本回合行动点已用完。'}</p>`}</section>` : '';
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
    <div class="unit-details"><div class="unit-detail"><small>攻</small><strong>${species.attack}</strong></div><div class="unit-detail"><small>防</small><strong>${species.defense}</strong></div><div class="unit-detail"><small>程</small><strong>${species.range}</strong></div><div class="unit-detail"><small>移</small><strong>${species.move + doctrineEffects(player, view.eraProgression, unit, CONTENT).movementBonus + promotionMovement(view, unit.id)}</strong></div><div class="unit-detail"><small>视</small><strong>${species.vision}</strong></div><div class="unit-detail"><small>P</small><strong>${species.power}</strong></div></div>
    ${view.gameplayVersion ? `<p class="unit-note" id="assault-role">兵种：${ROLE_CITY_ASSAULT[species.role].label} · ${ROLE_CITY_ASSAULT[species.role].note}${doctrineEffects(player, view.eraProgression, unit, CONTENT).cityDamageBonus ? `；领袖战术再 +${doctrineEffects(player, view.eraProgression, unit, CONTENT).cityDamageBonus / 10}%` : ''}</p>` : ''}
    <div class="unit-actions"><button id="move-unit" class="${mode === 'move' ? 'selected' : ''}" ${busy || !unit.actionLeft ? 'disabled' : ''}>${mode === 'move' ? '取消移动' : '移动'}</button><button id="attack-unit" class="${mode === 'attack' ? 'selected' : ''}" ${busy || !unit.actionLeft ? 'disabled' : ''}>攻击</button><button id="capture-unit" class="${mode === 'capture' ? 'selected' : ''}" ${busy || !unit.actionLeft || !canCapture ? 'disabled' : ''}>捕捉</button><button id="evolve-unit" ${busy || !unit.actionLeft || !canEvolve ? 'disabled' : ''}>${evolution ? `进化→${CONTENT.species[evolution.speciesId].name}` : '不可进化'}</button></div>
    ${view.expansion?.essences ? `<p class="unit-note" id="essence-note">属性精华：${identityEssences(unit, CONTENT).map(id => ESSENCES[id].name).join('、')} · 在${identityEssences(unit, CONTENT).map(id => BIOME_LABEL[ESSENCES[id].biome]).join('、')}防守时受伤 −10%</p>` : ''}
    ${usesTactics(view) ? `<p class="unit-note" id="zoc-note">${exertsZoc(unit, CONTENT) ? '控制区：相邻敌军移动到此即停下。' : ''}${ignoresZoc(unit, CONTENT) ? '可无视敌方控制区。' : '进入敌方近战/快速单位相邻格会停下。'}夹击：每只相邻目标的友军 +10% 伤害（最多 +30%）。</p>` : ''}
    ${promotionMarkup(view, unit.id, busy)}
    ${eraMarkup}
    ${improvementMarkup}
    ${branchMarkup}
    ${evolutionNote ? `<p class="unit-note" id="evolution-blocker">进化→${CONTENT.species[evolution!.speciesId].name}：${EVOLUTION_BLOCKER_TEXT[evolutionNote]}。</p>` : ''}
    ${!canCapture ? '<p class="unit-note">捕捉需要研究「驯化」，并在城市采购精灵球。</p>' : ''}
    ${mode && mode !== 'move' ? `<div class="action-config">${mode === 'capture' ? `<label>球种<select id="capture-ball"><option value="pokeBall" ${ballId === 'pokeBall' ? 'selected' : ''}>精灵球（${view.economy.player.ballInventory.pokeBall}）</option><option value="greatBall" ${ballId === 'greatBall' ? 'selected' : ''}>超级球（${view.economy.player.ballInventory.greatBall}）</option></select></label>` : ''}<button id="cancel-action">取消目标</button></div>${preview}<div class="action-confirm"><button id="confirm-action" class="primary" ${!target || (mode === 'attack' ? attackPreview?.ok !== true : capturePreview?.ok !== true) ? 'disabled' : ''}>确认${mode === 'attack' ? '攻击' : '捕捉'}</button></div>` : ''}
    ${stoneEvolution ? `<p class="unit-note">进化需要 ${WORLD_DEFINITIONS.stones[stoneEvolution.stoneId].name} + EXP ${stoneEvolution.requiredXp}，请在「树果、进化石与满意度」中使用。</p>` : evolution ? `<p class="unit-note">进化条件：EXP ${evolution.xp} + ${evolution.gold} 金币${evolution.requiresTraining ? ' + 特训法' : ''}；经验、金币与科技条件需同时满足。</p>` : ''}</div>`;
  root.querySelector('#move-unit')!.addEventListener('click', () => callbacks.mode(mode === 'move' ? null : 'move'));
  root.querySelector('#attack-unit')!.addEventListener('click', () => callbacks.mode(mode === 'attack' ? null : 'attack'));
  root.querySelector('#capture-unit')!.addEventListener('click', () => callbacks.mode(mode === 'capture' ? null : 'capture'));
  root.querySelector('#evolve-unit')!.addEventListener('click', () => callbacks.evolve(CONTENT.roster && evolution ? evolution.speciesId : undefined));
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-evolve]')) button.addEventListener('click', () => callbacks.evolve(button.dataset.evolve as SpeciesId));
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
