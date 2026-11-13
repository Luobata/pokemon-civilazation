// Playtest 2026-11 U5: why a capture cannot happen, in the order a player would fix it. The checks mirror
// previewCapture (src/core/preview.ts) and the authority's validation; this only words them.
import type { BallId } from '../content/economy.ts';
import { contentForView, techOf } from '../content/units.ts';
import { hexDistance, hexToIndex } from '../core/hex.ts';
import type { PlayerView } from '../core/model.ts';
import { viewIsRivalUnit } from '../core/rivals.ts';
import { isEmbarked } from '../core/terrain.ts';

const BALL_NAMES: Record<BallId, string> = { pokeBall: '精灵球', greatBall: '超级球' };

/** Why the selected unit cannot capture anything right now (no target needed), or null. */
export function captureUnitReason(view: PlayerView, unitId: number, ballId: BallId): string | null {
  const content = contentForView(view), player = view.economy.player;
  const unit = view.units.find(item => item.id === unitId && item.ownerId === view.playerId);
  if (!unit || unit.kind !== 'pokemon') return '只有宝可梦可以捕捉。';
  if (!unit.actionLeft) return '这只宝可梦本回合已行动，结束回合后再捕捉。';
  if (!player.research.unlockedIds.includes('domestication')) return `需要先研究「${techOf(content, 'domestication').name}」。`;
  const ball = content.balls[ballId];
  if (!ball || !player.research.unlockedIds.includes(ball.requiredTech)) return `${BALL_NAMES[ballId]}需要先研究「${techOf(content, ball?.requiredTech ?? 'ballCraft').name}」。`;
  if (player.ballInventory[ballId] < 1) return `没有${BALL_NAMES[ballId]}了：选中城市，在「物资采购」购买（顶栏的球数可直接前往）。`;
  if (isEmbarked(unit, view.map, content)) return '在水上不能捕捉，先上岸。';
  return null;
}

/** Why the selected unit cannot capture what stands on `tileIndex`, or null when the capture is possible. */
export function captureTargetReason(view: PlayerView, unitId: number, tileIndex: number, ballId: BallId): string | null {
  const unit = view.units.find(item => item.id === unitId && item.ownerId === view.playerId);
  const target = view.units.find(item => hexToIndex(item.position, view.map) === tileIndex && item.id !== unitId);
  if (!target) return '这里没有可捕捉的宝可梦。';
  if (target.kind !== 'pokemon') return '只能捕捉宝可梦，不能捕捉开拓队、工匠或商队。';
  if (target.ownerId === view.playerId) return '这是你自己的宝可梦。';
  if (viewIsRivalUnit(view, target.id)) return '劲敌的宝可梦不能捕捉，只能击退。';
  if (target.ownerId !== null) return `只能捕捉野生宝可梦：这是文明 ${target.ownerId + 1} 的宝可梦。`;
  const general = captureUnitReason(view, unitId, ballId);
  if (general) return general;
  const distance = unit ? hexDistance(unit.position, target.position, view.map) : Infinity;
  if (distance !== 1) return `目标不相邻（相距 ${distance} 格）：先移动到它旁边的格子。`;
  return null;
}

/** For capture mode without targets: the general reason, else the nearest wild Pokémon in sight. */
export function captureNoTargetReason(view: PlayerView, unitId: number, ballId: BallId): string {
  const general = captureUnitReason(view, unitId, ballId);
  if (general) return general;
  const unit = view.units.find(item => item.id === unitId)!;
  const wild = view.units.filter(item => item.kind === 'pokemon' && item.ownerId === null && !viewIsRivalUnit(view, item.id))
    .map(item => hexDistance(unit.position, item.position, view.map)).sort((a, b) => a - b)[0];
  return wild === undefined ? '视野内没有野生宝可梦。' : `没有相邻的野生宝可梦：最近的一只相距 ${wild} 格，先移动到它旁边。`;
}
