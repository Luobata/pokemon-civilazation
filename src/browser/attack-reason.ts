// Playtest 2026-11b N9: why the selected Pokémon cannot attack what stands on a tile, in the player's words. The checks are
// previewAttack's own (src/core/preview.ts, the authority's validation on the view); this only words its refusal reasons.
import { contentForView } from '../content/units.ts';
import { hexDistance, hexToIndex } from '../core/hex.ts';
import type { CombatTarget, PlayerView } from '../core/model.ts';
import { previewAttack } from '../core/preview.ts';
import { civName } from './civ-names.ts';


/** Why the selected unit cannot attack the unit or city on `tileIndex` (null when the attack is possible). */
export function attackTargetReason(view: PlayerView, unitId: number, tileIndex: number): string | null {
  const content = contentForView(view), unit = view.units.find(item => item.id === unitId && item.ownerId === view.playerId);
  const city = view.cities.find(item => hexToIndex(item.position, view.map) === tileIndex);
  const other = view.units.find(item => item.id !== unitId && hexToIndex(item.position, view.map) === tileIndex);
  // A foreign city is the target of its tile (as on the map); else the unit standing there.
  const target: CombatTarget | null = city && city.ownerId !== view.playerId ? { kind: 'city', id: city.id } : other ? { kind: 'unit', id: other.id } : city ? { kind: 'city', id: city.id } : null;
  if (!target) return unit && hexToIndex(unit.position, view.map) === tileIndex ? '不能攻击自己：选一个红色虚线圈出的目标。'
    : view.visibleTileIds.includes(tileIndex) ? '这里没有可攻击的目标。' : '这一格不在视野内：先派单位过去看清楚。';
  const defender = target.kind === 'city' ? city! : other!;
  if (defender.ownerId === view.playerId) return target.kind === 'city' ? '这是你自己的城市。' : '这是你自己的单位。';
  const preview = previewAttack(view, unitId, target, content);
  if (preview.ok) return null;
  if (!unit || unit.kind !== 'pokemon') return '只有宝可梦可以攻击。';
  const distance = hexDistance(unit.position, defender.position, view.map), range = content.species[unit.speciesId].range;
  switch (preview.reason) {
    case 'embarked': return '在水上不能攻击，先上岸。';
    case 'at-peace': return `与${civName(view, defender.ownerId!)}处于和平：先在外交页宣战，才能攻击它的单位和城市。`;
    case 'out-of-range': return 'kind' in defender && defender.kind === 'logistics' && distance > 1 && distance <= range
      ? `开拓队、工匠和商队只能近身攻击：先移动到它旁边（现在相距 ${distance} 格）。`
      : `超出射程：相距 ${distance} 格，${content.species[unit.speciesId].name}的射程是 ${range} 格。先靠近一些。`;
    case 'escorted': return '这支职能单位和对方的宝可梦站在同一格，受到保护：先击倒那只宝可梦。';
    default: return !unit.actionLeft ? '这只宝可梦本回合已行动，结束回合后再攻击。'
      : view.activePlayerId !== view.playerId ? '现在不是你的回合。' : '现在不能攻击这个目标。';
  }
}
