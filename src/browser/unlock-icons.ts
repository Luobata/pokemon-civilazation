// Pictures for what a technology is about and what it unlocks (research tree, handbook-style lists). Recruits show the
// species sprite, buildings their SVG art, districts / improvements their map icon, HMs their disc; rule effects get a
// subject icon. Every chip carries the full sentence as its accessible name and title.
import type { TechId } from '../content/economy.ts';
import type { BuildingId } from '../content/economy.ts';
import type { SpeciesId } from '../content/species.ts';
import type { UnitClass } from '../content/unit-classes.ts';
import { buildingArtPath } from './building-art.ts';
import { pokemonSpritePath } from './sprites.ts';
import type { TechUnlock } from './tech-info.ts';
import { artImage, escapeAttr, HM_OF_CLASS, uiIcon } from './ui-icons.ts';
import type { UiIconName } from './ui-icons.ts';

/** The subject icon of each technology (node centre, detail header). */
export const TECH_ICONS: Record<TechId, UiIconName> = {
  domestication: 'pokeBall', berryCultivation: 'oranBerry', stoneCraft: 'mine', seafaring: 'harborDistrict',
  ballCraft: 'greatBall', riding: 'class:fast', typeResearch: 'gym', fieldObservation: 'observatoryCamp', masonry: 'brick', commerce: 'handshake',
  lureCraft: 'honeyHive', medicine: 'medicine', electricity: 'powerPlantDistrict', siegeCraft: 'class:siege', meteorology: 'cloud', contestArts: 'ribbon',
  training: 'swords', laboratory: 'research', urbanPlanning: 'district', aviation: 'class:air', oceanography: 'class:naval', leagueRules: 'policyCard',
  breeding: 'egg', eliteTraining: 'trophy', legendLore: 'tablet', steelworks: 'anvil', cartography: 'map',
  masterBallTheory: 'masterBall', dragonLore: 'type:dragon', championLeague: 'crown',
};
/** Icon for a technology's rule effect (the "效果" unlock). */
const EFFECT_ICONS: Partial<Record<TechId, UiIconName>> = {
  domestication: 'pokeBall', berryCultivation: 'food', stoneCraft: 'production', ballCraft: 'greatBall', typeResearch: 'gym', riding: 'class:fast',
  fieldObservation: 'research', medicine: 'medicine', training: 'star', siegeCraft: 'class:siege', leagueRules: 'trophy', meteorology: 'cloud',
  commerce: 'handshake', lureCraft: 'pokeBall', contestArts: 'ribbon', urbanPlanning: 'construction', eliteTraining: 'trophy', cartography: 'map',
  legendLore: 'research', steelworks: 'production', masterBallTheory: 'masterBall', championLeague: 'crown', seafaring: 'hm:surf', oceanography: 'hm:surf',
};
const SVG_BUILDINGS: readonly string[] = ['headquarters', 'pasture', 'workshop', 'meetingHall', 'observatory', 'trainingGround'];
const MAP_DISTRICTS: readonly string[] = ['researchDistrict', 'gymDistrict', 'harborDistrict', 'powerPlantDistrict', 'gardenDistrict'];
const MAP_IMPROVEMENTS: readonly string[] = ['berryFarm', 'mine', 'fishery', 'observatoryCamp', 'ranch', 'honeyHive', 'pearlBed', 'berryGrove', 'stoneQuarry', 'plantation'];
export const UNLOCK_KIND_NAMES: Record<TechUnlock['kind'], string> = { effect: '效果', building: '建筑', district: '设施区', recruit: '招募', class: '秘传', improvement: '改良' };
const KIND_ICONS: Record<TechUnlock['kind'], UiIconName> = { effect: 'effect', building: 'building', district: 'district', recruit: 'unit', class: 'hm:surf', improvement: 'improvement' };

/** The picture (decorative markup) for one unlock at `size` px. */
export function unlockPicture(item: TechUnlock, techId: TechId, size: number): string {
  const ref = item.ref;
  if (item.kind === 'recruit' && ref) return artImage(pokemonSpritePath(ref as SpeciesId), { size, className: 'sprite' });
  if (item.kind === 'building' && ref && SVG_BUILDINGS.includes(ref)) return artImage(buildingArtPath(ref as BuildingId), { size, className: 'building-art' });
  if (item.kind === 'district' && ref && MAP_DISTRICTS.includes(ref)) return uiIcon(ref as UiIconName, { size });
  if (item.kind === 'improvement' && ref && MAP_IMPROVEMENTS.includes(ref)) return uiIcon(ref as UiIconName, { size });
  if (item.kind === 'class' && ref && HM_OF_CLASS[ref as UnitClass]) return uiIcon(`hm:${HM_OF_CLASS[ref as UnitClass]!}`, { size });
  if (item.kind === 'effect') return uiIcon(EFFECT_ICONS[techId] ?? 'effect', { size });
  return uiIcon(KIND_ICONS[item.kind], { size });
}

/** An icon-only unlock chip; the sentence is its accessible name and tooltip. */
export function unlockChip(item: TechUnlock, techId: TechId, size = 20): string {
  const label = `${UNLOCK_KIND_NAMES[item.kind]}：${item.text}`;
  return `<span class="unlock-chip ${item.kind}${item.boost ? ' boost' : ''}" role="img" aria-label="${escapeAttr(label)}" title="${escapeAttr(label)}">${unlockPicture(item, techId, size)}</span>`;
}
