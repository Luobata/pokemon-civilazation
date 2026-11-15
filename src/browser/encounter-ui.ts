// Gameplay v27 ① ② presentation (docs/design/pace-v27.md §2.4, §3.4): the startled-civilian notice, the "wild Pokémon is exhausted —
// throw a ball now" encounter notice, the exhausted line on the tile card and the capture-preview note. Pure description from the
// player's own view (exhaustion is a public unit field; the first-ball flag is the viewer's own ledger).
import { ROLE_POKEMON } from '../content/roles.ts';
import { openingTuning } from '../content/pace-v27.ts';
import { contentForView } from '../content/units.ts';
import type { Content } from '../content/units.ts';
import type { MapUnit, PlayerView, VisibleEvent } from '../core/model.ts';
import { isExhausted, viewFirstBallUsed } from '../core/wild-encounters.ts';
import type { DepthToast } from './late-game-ui.ts';

/** Notification glyphs (notification-rail.ts maps them to the `startled` / `exhausted` icons). */
export const STARTLED_GLYPH = '‼', EXHAUSTED_GLYPH = '≋';

export function encounterToast(payload: VisibleEvent['payload'], view: PlayerView): DepthToast | null {
  const content = contentForView(view), me = view.playerId;
  if (payload.type === 'CivilianFled' && payload.playerId === me) {
    const unit = view.units.find(item => item.id === payload.unitId), role = unit?.kind === 'logistics' ? ROLE_POKEMON[unit.role].unitName : '职能单位';
    return { tone: 'info', icon: STARTLED_GLYPH, title: `${role}被野生的${content.species[payload.wildSpeciesId]?.name ?? '宝可梦'}吓跑了`,
      detail: '它退到了离野生宝可梦 2 格的地方，没有受伤。', target: { kind: 'unit', unitId: payload.unitId } };
  }
  if (payload.type === 'WildExhausted' && payload.playerId === me && payload.firstEncounter) {
    const tuning = openingTuning(content), name = content.species[payload.speciesId]?.name ?? '宝可梦';
    return { tone: 'growth', icon: EXHAUSTED_GLYPH, title: `野生的${name}力竭了！`,
      detail: `现在扔球：捕捉率 +${tuning.exhaustCaptureBonus}%${viewFirstBallUsed(view) ? '' : '（你的第一颗球对任何野生宝可梦都必中）'}。初次遭遇：经验 +${payload.xp}、科研 +${payload.science}。`
        + `力竭到第 ${payload.untilRound} 轮结束，期间它不攻击、不移动。`,
      target: { kind: 'unit', unitId: payload.unitId }, action: '捕捉', key: `exhausted:${payload.targetUnitId}` };
  }
  return null;
}
/** The tile-card line of an exhausted wild Pokémon (null otherwise). */
export function exhaustedLine(view: PlayerView, unit: MapUnit, content: Content = contentForView(view)): string | null {
  if (!content.wildEncounters || unit.ownerId !== null || !isExhausted(unit, view.round)) return null;
  const left = unit.exhaustedUntilRound! - view.round + 1;
  return `力竭：不攻击、不移动，捕捉率 +${openingTuning(content).exhaustCaptureBonus}% · 还剩 ${left} 轮`;
}
/** The capture-preview note for a target (the certain first ball, or the exhausted bonus); '' when none applies. */
export function captureNote(view: PlayerView, target: MapUnit | undefined, content: Content = contentForView(view)): string {
  if (!target || !content.wildEncounters || target.ownerId !== null) return '';
  if (!viewFirstBallUsed(view)) return '（第一颗球必中）';
  return isExhausted(target, view.round) ? `（力竭 +${openingTuning(content).exhaustCaptureBonus}%）` : '';
}
