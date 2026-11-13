// depth-v26 §4.1 (presentation only): the evolution-conditions panel of the unit panel. The evolution line as sprites
// (current form highlighted, forms not yet in the Pokédex as silhouettes), then one card per next form — every Eevee
// branch, stone paths too — with its conditions as icon chips that are met or not: EXP (or Rare Candy), gold, the
// 特训法 tech, the era lock, day / night, the terrain, the evolution stone, plus the city-training badge note of final
// forms. Every check calls the authority's own rule functions (evolutionOptions / evolutionBlocker / candyGold /
// evolutionGold / stoneEvolutionsFor / generationAllows / classTrainingBlocker); nothing is re-implemented here.
import { ERA_DEFINITIONS } from '../content/eras.ts';
import { stoneEvolutionsFor, speciesGeneration } from '../content/roster.ts';
import type { EvolutionOption, SpeciesId } from '../content/species.ts';
import { CLASS_RULES } from '../content/unit-classes.ts';
import { TYPE_ESSENCE } from '../content/essences.ts';
import { ESSENCES } from '../content/essences.ts';
import { WORLD_DEFINITIONS } from '../content/world-systems.ts';
import { techOf } from '../content/units.ts';
import type { Content } from '../content/units.ts';
import { evolutionGold } from '../core/leader-systems.ts';
import { evolutionBlocker, evolutionOptions, generationAllows, playerGeneration, tileBiome } from '../core/roster.ts';
import { candyGold, classTrainingBlocker, usesUnitClasses, viewBadges } from '../core/unit-classes.ts';
import type { MapUnit, PlayerView } from '../core/model.ts';
import { isNight } from '../content/era-abilities.ts';
import { BIOME_DISPLAY } from './canvas.ts';
import { pokemonSpritePath } from './sprites.ts';
import { BIOME_ICONS, UI_ICON_NAMES, artImage, escapeAttr, typeBadge, uiIcon } from './ui-icons.ts';
import type { UiIconName } from './ui-icons.ts';
import '../evolution-panel.css';

type Pokemon = Extract<MapUnit, { kind: 'pokemon' }>;
/** One condition: the icon, a short visible value, the full sentence (hover card, accessible name) and whether it holds now. */
export type EvolutionCheck = { id: 'xp' | 'candy' | 'gold' | 'tech' | 'era' | 'time' | 'terrain' | 'stone' | 'action'; icon: UiIconName; value: string; text: string; met: boolean;
  /** XP progress 0–1 (the EXP chip draws a small bar). */ progress?: number };
export type EvolutionCard = { speciesId: SpeciesId; kind: 'level' | 'stone'; checks: EvolutionCheck[]; ready: boolean; main: boolean;
  stoneId?: string; training?: { met: boolean; text: string; icon: UiIconName } };

const eraName = (view: PlayerView, generation: number) => ERA_DEFINITIONS[view.eraProgression ?? 'simple-v1']?.[generation - 1]?.name ?? `第 ${generation} 世代`;
const iconOr = (name: string, fallback: UiIconName): UiIconName => (UI_ICON_NAMES as readonly string[]).includes(name) ? name as UiIconName : fallback;

/** The conditions of every next form of this unit, in the authority's order (main branch first, then the other branches, then stone paths). */
export function evolutionCards(view: PlayerView, unit: Pokemon, content: Content, mainSpeciesId: SpeciesId | null): EvolutionCard[] {
  const player = view.economy.player, species = content.species[unit.speciesId], mode = view.eraProgression;
  const generation = playerGeneration(player, mode), context = { generation, round: view.round, biome: tileBiome(view, unit.position) };
  const stones = view.expansion ? stoneEvolutionsFor(content).filter(path => path.fromSpeciesId === unit.speciesId) : [];
  // combat.ts: a species with a stone path never evolves normally into that form (and, without roster tables, not at all).
  const levelOptions = view.expansion && !content.roster && stones.length ? [] : evolutionOptions(content, unit.speciesId).filter(option => !stones.some(path => path.intoSpeciesId === option.speciesId));
  const badges = viewBadges(view), action = !unit.actionLeft ? [{ id: 'action' as const, icon: 'move' as UiIconName, value: '', text: '本回合已行动：下回合才能进化', met: false }] : [];
  const training = (speciesId: SpeciesId): EvolutionCard['training'] => {
    if (!usesUnitClasses(view) || content.species[speciesId]?.stage !== 3) return undefined;
    const blocker = classTrainingBlocker(view, player, mode, badges, speciesId, content), essence = TYPE_ESSENCE[content.species[speciesId].typeId];
    return blocker ? { met: false, text: `城市直接训练${content.species[speciesId].name}：${blocker.text}（进化本身不需要徽章）`, icon: blocker.kind === 'badge' ? `gym:${content.species[speciesId].typeId}` : 'lock' }
      : { met: true, text: `城市可直接训练${content.species[speciesId].name}（已有「${ESSENCES[essence].name}」徽章）`, icon: `gym:${content.species[speciesId].typeId}` };
  };
  const cards: EvolutionCard[] = levelOptions.map(option => {
    const checks: EvolutionCheck[] = [];
    const cost = evolutionGold(player, option.gold), candy = unit.xp < option.xp ? candyGold(view, player, mode, species.stage, cost) : null;
    const xpMet = unit.xp >= option.xp;
    checks.push({ id: 'xp', icon: 'star', value: `${unit.xp}/${option.xp}`, text: `经验 ${unit.xp}/${option.xp}${xpMet ? '（已满足）' : candy !== null ? '（可用神奇糖果跳过）' : ''}`, met: xpMet || candy !== null, progress: Math.min(1, unit.xp / option.xp) });
    if (!xpMet && candy !== null) checks.push({ id: 'candy', icon: 'candy', value: `${candy}`, text: `神奇糖果：经验不足时付 ${candy} 金直接进化（${CLASS_RULES.candyGoldMultiplier} 倍金币）`, met: player.gold >= candy });
    else if (!xpMet && usesUnitClasses(view) && species.stage === 1 && generation < CLASS_RULES.candyGeneration) {
      checks.push({ id: 'candy', icon: 'candy', value: '', text: `神奇糖果：进入${eraName(view, CLASS_RULES.candyGeneration)}后，一阶宝可梦可付 ${CLASS_RULES.candyGoldMultiplier} 倍金币跳过经验`, met: false });
    }
    const price = xpMet || candy === null ? cost : candy;
    checks.push({ id: 'gold', icon: 'gold', value: `${price}`, text: `金币 ${player.gold}/${price}`, met: player.gold >= price });
    if (option.requiresTraining) {
      const has = player.research.unlockedIds.includes('training');
      checks.push({ id: 'tech', icon: 'building', value: '', text: `科技「${techOf(content, 'training').name}」${has ? '（已研究）' : '（未研究）'}`, met: has });
    }
    // Era, time and terrain: each asked of the shared rule on its own (the other two conditions taken out).
    const required = content.roster ? Math.max(option.minGeneration ?? 1, speciesGeneration(content, option.speciesId)) : 1;
    if (required > 1) checks.push({ id: 'era', icon: 'eraScore', value: `${required}`, text: `需要进入${eraName(view, required)}（现在：${eraName(view, generation)}）`,
      met: evolutionBlocker(content, { ...option, time: undefined, biome: undefined } as EvolutionOption, context) !== 'generation' });
    if (option.time) {
      const met = !evolutionBlocker(content, { ...option, biome: undefined } as EvolutionOption, { ...context, generation: Infinity });
      checks.push({ id: 'time', icon: option.time === 'day' ? 'sun' : 'moon', value: '', text: `只能在${option.time === 'day' ? '白天' : '夜晚'}进化（现在是${isNight(view.round) ? '夜晚' : '白天'}，每 2 轮昼夜交替）`, met });
    }
    if (option.biome) {
      const met = !evolutionBlocker(content, { ...option, time: undefined } as EvolutionOption, { ...context, generation: Infinity });
      checks.push({ id: 'terrain', icon: BIOME_ICONS[option.biome], value: '', text: `站在${BIOME_DISPLAY[option.biome].label}地块上进化${met ? '（已在此地形）' : ''}`, met });
    }
    checks.push(...action);
    return { speciesId: option.speciesId, kind: 'level', checks, ready: checks.every(check => check.met), main: option.speciesId === mainSpeciesId, training: training(option.speciesId) };
  });
  const stock = view.expansion?.world?.player?.stoneInventory;
  for (const path of stones) {
    const have = (stock as Record<string, number> | undefined)?.[path.stoneId] ?? 0, stoneName = WORLD_DEFINITIONS.stones[path.stoneId as keyof typeof WORLD_DEFINITIONS.stones]?.name ?? path.stoneId;
    const checks: EvolutionCheck[] = [
      { id: 'stone', icon: iconOr(path.stoneId, 'essence'), value: `${have}`, text: `${stoneName}：库存 ${have}（用掉 1 颗；在矿脉采集）`, met: have >= 1 },
      { id: 'xp', icon: 'star', value: `${unit.xp}/${path.requiredXp}`, text: `经验 ${unit.xp}/${path.requiredXp}`, met: unit.xp >= path.requiredXp, progress: Math.min(1, unit.xp / Math.max(1, path.requiredXp)) },
    ];
    const allowed = generationAllows(content, player, mode, path.intoSpeciesId as SpeciesId);
    if (!allowed || speciesGeneration(content, path.intoSpeciesId as SpeciesId) > 1) checks.push({ id: 'era', icon: 'eraScore', value: `${speciesGeneration(content, path.intoSpeciesId as SpeciesId)}`,
      text: `需要进入${eraName(view, speciesGeneration(content, path.intoSpeciesId as SpeciesId))}`, met: allowed });
    checks.push(...action);
    cards.push({ speciesId: path.intoSpeciesId as SpeciesId, kind: 'stone', stoneId: path.stoneId, checks, ready: checks.every(check => check.met), main: false, training: training(path.intoSpeciesId as SpeciesId) });
  }
  return cards;
}

/** The whole line around this form: earlier forms, this one, and the forms after (one step past each next form). */
function lineMarkup(view: PlayerView, unit: Pokemon, content: Content, cards: readonly EvolutionCard[]): string {
  const pokedex = view.expansion?.world?.player?.pokedex as Record<string, { observed: boolean; battled: boolean; captured: boolean }> | undefined;
  const seen = (id: SpeciesId) => !pokedex || Boolean(pokedex[id]?.observed || pokedex[id]?.battled || pokedex[id]?.captured);
  const before: SpeciesId[] = [];
  for (let current: SpeciesId | undefined = unit.speciesId, guard = 0; current && guard < 3; guard++) {
    current = (Object.keys(content.species) as SpeciesId[]).find(id => evolutionOptions(content, id).some(option => option.speciesId === current)
      || stoneEvolutionsFor(content).some(path => path.fromSpeciesId === id && path.intoSpeciesId === current));
    if (current) before.unshift(current);
  }
  const form = (id: SpeciesId, size: number, current = false) => `<span class="evo-form${current ? ' current' : ''}${seen(id) || current ? '' : ' unseen'}">${artImage(pokemonSpritePath(id), { size, label: `${content.species[id]?.name ?? id}${current ? '（当前）' : seen(id) ? '' : '（图鉴未登记）'}` })}</span>`;
  const arrow = '<span class="evo-arrow" aria-hidden="true">›</span>';
  const after = cards.map(card => {
    const later = evolutionOptions(content, card.speciesId).map(option => option.speciesId);
    return `<span class="evo-branch">${form(card.speciesId, 32)}${later.length === 1 ? `${arrow}${form(later[0]!, 24)}` : ''}</span>`;
  }).join('');
  return `<div class="evo-line" role="list" aria-label="进化线">${before.map(id => `${form(id, 24)}${arrow}`).join('')}${form(unit.speciesId, 36, true)}${cards.length ? `${arrow}<span class="evo-branches${cards.length > 1 ? ' fork' : ''}">${after}</span>` : '<span class="evo-final">最终形态</span>'}</div>`;
}
const chip = (check: EvolutionCheck) => `<li class="evo-check ${check.met ? 'met' : 'unmet'}" data-check="${check.id}" role="img" aria-label="${escapeAttr(`${check.text}${check.met ? '：满足' : '：未满足'}`)}" title="${escapeAttr(check.text)}">`
  + `${uiIcon(check.icon, { size: 14 })}${check.value ? `<b aria-hidden="true">${escapeAttr(check.value)}</b>` : ''}${check.progress !== undefined && check.progress < 1 ? `<i class="evo-bar" aria-hidden="true"><i style="width:${Math.round(check.progress * 100)}%"></i></i>` : ''}`
  + `<span class="evo-mark" aria-hidden="true">${check.met ? '✓' : '✗'}</span></li>`;
function cardMarkup(view: PlayerView, unit: Pokemon, content: Content, card: EvolutionCard, busy: boolean): string {
  const target = content.species[card.speciesId], name = target.name;
  const button = card.kind === 'stone'
    ? `<button type="button" data-evolve-stone="${card.speciesId}:${card.stoneId}" ${busy || !card.ready ? 'disabled' : ''} title="${escapeAttr(`用${WORLD_DEFINITIONS.stones[card.stoneId as keyof typeof WORLD_DEFINITIONS.stones]?.name ?? ''}进化成${name}`)}">进化→${escapeAttr(name)}</button>`
    : `<button type="button" data-evolve="${card.speciesId}" ${busy || !card.ready ? 'disabled' : ''} title="${escapeAttr(card.ready ? `进化成${name}` : `还差：${card.checks.filter(check => !check.met).map(check => check.text).join('；')}`)}">进化→${escapeAttr(name)}</button>`;
  return `<article class="evo-card${card.ready ? ' ready' : ''}${card.main ? ' main' : ''}" data-species="${card.speciesId}" aria-label="${escapeAttr(`进化成${name}：${card.ready ? '条件已满足' : '条件未满足'}`)}">
    <header>${artImage(pokemonSpritePath(card.speciesId), { size: 36, label: name })}<span><strong>${escapeAttr(name)}</strong><span class="evo-types">${typeBadge(target.typeId, 12)}${target.secondaryTypeId ? typeBadge(target.secondaryTypeId, 12) : ''}${card.kind === 'stone' ? uiIcon(iconOr(card.stoneId ?? '', 'essence'), { size: 12, label: '进化石进化' }) : ''}</span></span></header>
    <ul class="evo-checks">${card.checks.map(chip).join('')}</ul>
    ${card.training ? `<p class="evo-training ${card.training.met ? 'met' : 'unmet'}" role="img" aria-label="${escapeAttr(card.training.text)}" title="${escapeAttr(card.training.text)}">${uiIcon(card.training.icon, { size: 14 })}<small aria-hidden="true">城市训练</small><span class="evo-mark" aria-hidden="true">${card.training.met ? '✓' : '✗'}</span></p>` : ''}
    ${button}</article>`;
}
/**
 * The panel; the cards of branches other than the action bar's main one sit in `#evolution-branches` (their 进化 buttons,
 * `data-evolve`, are the same as before). Stone cards issue UseEvolutionStone (`data-evolve-stone="species:stone"`).
 */
export function evolutionPanelMarkup(view: PlayerView, unit: Pokemon, content: Content, mainSpeciesId: SpeciesId | null, busy: boolean): string {
  const cards = evolutionCards(view, unit, content, mainSpeciesId);
  const main = cards.filter(card => card.main), others = cards.filter(card => !card.main);
  const ready = cards.filter(card => card.ready).length;
  return `<section class="evo-panel" id="evolution-panel" aria-label="进化条件">
    <p class="section-label">${uiIcon('effect', { size: 14 })}进化${cards.length ? ` · ${ready ? `${ready} 个方向可进化` : '条件未满足'}` : ''}</p>
    ${lineMarkup(view, unit, content, cards)}
    ${cards.length ? `<div class="evo-cards">${main.map(card => cardMarkup(view, unit, content, card, busy)).join('')}${others.length ? `<div class="evolution-branches" id="evolution-branches">${others.map(card => cardMarkup(view, unit, content, card, busy)).join('')}</div>` : ''}</div>` : ''}
  </section>`;
}
