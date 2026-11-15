// Playtest 2026-11b F3: other civilizations are named after their leader ("小霞的华蓝联盟") wherever the view knows the leader,
// instead of "文明 2". Display only: no rule reads these names, and stored ids are unchanged. Cities keep their own names.
import { LEADERS } from '../content/leaders.ts';
import type { LeaderId } from '../content/leaders.ts';
import type { PlayerView } from '../core/model.ts';
import { flagImage } from './ui-icons.ts';

/** The civilization each leader heads (the leader's home town or team, in the games' Chinese names). */
export const LEADER_CIV_NAMES: Record<LeaderId, string> = {
  oak: '真新联盟', lance: '烟墨联盟', jenny: '警备联盟', joy: '护理联盟', brock: '深灰联盟',
  misty: '华蓝联盟', steven: '丰缘联盟', jasmine: '浅葱联盟', giovanni: '火箭队',
};
/** Seat colours (the map's faction colours). */
export const CIV_SEAT_COLORS = ['#3BA68A', '#D3655C', '#9B83D0', '#D59A45'];
export const civColor = (id: number): string => CIV_SEAT_COLORS[id] ?? '#5F6E66';

type Civs = Pick<PlayerView, 'civilizations'>;
const leaderOf = (view: Civs, id: number) => view.civilizations.find(civ => civ.id === id)?.leaderId;

/** "小霞的华蓝联盟", or "文明 2" when the view has no leader for that seat (legacy games). */
export function civName(view: Civs, id: number): string {
  const leader = leaderOf(view, id);
  return leader ? `${LEADERS[leader].name}的${LEADER_CIV_NAMES[leader]}` : `文明 ${id + 1}`;
}
/** "你" for the viewer, otherwise civName. */
export const civOrYou = (view: Civs & Pick<PlayerView, 'playerId'>, id: number): string => id === view.playerId ? '你' : civName(view, id);
/** The leader's name alone ("小霞"), or "文明 2". */
export function civLeaderName(view: Civs, id: number): string {
  const leader = leaderOf(view, id);
  return leader ? LEADERS[leader].name : `文明 ${id + 1}`;
}
/** A small flag in the seat colour, named for screen readers ("小霞的华蓝联盟（文明 2）"). */
export const civFlag = (view: Civs, id: number, size = 16): string =>
  flagImage(civColor(id), { size, label: leaderOf(view, id) ? `${civName(view, id)}（文明 ${id + 1}）` : civName(view, id), className: 'civ-flag' });
