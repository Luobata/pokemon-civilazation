// End-turn state machine (P0-5, Civilization-style): the button names the first thing still waiting for the
// player ("选择研究 ›", "城市 1 需要生产 ›", "单位需要命令（2）›") and a click goes there; only with nothing
// pending does it read "第 N 轮 · 下一回合 ›". Shift+click or Ctrl/⌘+Enter ends the turn regardless.
// Units have no "skip" command, so a unit the button has already led the player to counts as reviewed for the
// rest of the round (it stays selectable with the ‹ › cycle buttons).
import type { TechId } from '../content/economy.ts';
import type { EXPANSION_CONTENT } from '../content/units.ts';
import { CHARTERS } from '../content/policies.ts';
import { canResearch } from '../core/economy-commands.ts';
import { hexDistance } from '../core/hex.ts';
import type { PlayerView } from '../core/model.ts';

export type Reminder = { label: string; target: string };
export type TurnStep =
  | { kind: 'research' | 'charter'; label: string; panel: string }
  | { kind: 'city'; label: string; cityId: number }
  | { kind: 'unit'; label: string; unitId: number; remaining: number }
  | { kind: 'ready'; label: string };

/** Units waiting for orders this round that the end-turn button has already shown (cleared when the round changes). */
export class ReviewedUnits {
  private round = -1;
  private readonly ids = new Set<number>();
  of(round: number): ReadonlySet<number> { if (round !== this.round) { this.round = round; this.ids.clear(); } return this.ids; }
  add(round: number, unitId: number): void { this.of(round); this.ids.add(unitId); }
  clear(): void { this.round = -1; this.ids.clear(); }
}

export const idleCityIds = (view: PlayerView): number[] => view.economy.cities.filter(city => city.queue.length === 0).map(city => city.id).sort((a, b) => a - b);
export const idleUnitIds = (view: PlayerView): number[] => view.units.filter(unit => unit.ownerId === view.playerId && unit.actionLeft).map(unit => unit.id).sort((a, b) => a - b);
/** The id after (step 1) or before (step −1) `current` in a sorted id list, wrapping around. */
export function cycleId(ids: readonly number[], current: number | null, step: 1 | -1 = 1): number | null {
  if (!ids.length) return null;
  if (step === 1) return ids.find(id => id > (current ?? -1)) ?? ids[0]!;
  return [...ids].reverse().find(id => id < (current ?? Infinity)) ?? ids.at(-1)!;
}

/** Reminders shown as chips above the end-turn button (Civilization "needs orders"). */
export function turnReminders(view: PlayerView, content: typeof EXPANSION_CONTENT, reviewed: ReadonlySet<number> = new Set()): Reminder[] {
  const items: Reminder[] = [];
  const player = view.economy.player;
  if (player.research.techId === null && (Object.keys(content.techs) as TechId[]).some(id => canResearch(player, id))) items.push({ label: '选择研究', target: '#research-panel' });
  const policies = view.expansion?.policies;
  if (policies && policies.charterId === null && policies.adopted.length < Object.keys(CHARTERS).length) items.push({ label: '选择规章', target: '#policy-panel' });
  const shaky = Object.values(view.expansion?.bonds ?? {}).filter(info => info.bond < 30 && info.pressure.total < 0).length;
  if (shaky) items.push({ label: `${shaky} 城羁绊告急`, target: 'city' });
  const exposed = view.units.filter(unit => unit.ownerId === view.playerId && unit.kind === 'logistics'
    && !view.economy.cities.some(city => hexDistance(city.position, unit.position) === 0)
    && view.units.some(other => other.kind === 'pokemon' && other.ownerId !== view.playerId && (other.ownerId === null || view.diplomacy.some(pair => pair.status === 'war' && (pair.a === other.ownerId || pair.b === other.ownerId) && (pair.a === view.playerId || pair.b === view.playerId))) && hexDistance(other.position, unit.position) <= 2)
    && !view.units.some(guard => guard.ownerId === view.playerId && guard.kind === 'pokemon' && hexDistance(guard.position, unit.position) <= 1));
  if (exposed.length) items.push({ label: `开拓队有危险`, target: `danger:${exposed[0]!.id}` });
  const idleCities = idleCityIds(view).length;
  if (idleCities) items.push({ label: `${idleCities} 城空闲`, target: 'city' });
  const settler = view.units.find(unit => unit.ownerId === view.playerId && unit.kind === 'logistics' && unit.actionLeft);
  if (settler && !exposed.length) items.push({ label: '开拓队：去建新城', target: `unit:${settler.id}` });
  const idleUnits = idleUnitIds(view).filter(id => !reviewed.has(id)).length;
  if (idleUnits) items.push({ label: `${idleUnits} 单位待命`, target: 'unit' });
  return items;
}

/** What the end-turn button says and where a plain click goes: research, charter, an idle city, a unit waiting for orders, or the next turn. */
export function turnStep(view: PlayerView, reminders: readonly Reminder[], selection: { unitId: number | null; cityId: number | null }, reviewed: ReadonlySet<number>): TurnStep {
  if (reminders.some(item => item.target === '#research-panel')) return { kind: 'research', label: '选择研究 ›', panel: '#research-panel' };
  if (reminders.some(item => item.target === '#policy-panel')) return { kind: 'charter', label: '选择规章 ›', panel: '#policy-panel' };
  const cities = idleCityIds(view);
  if (cities.length) {
    // Stay on the selected city while it still needs production; otherwise go to the next idle one.
    const cityId = selection.cityId !== null && cities.includes(selection.cityId) ? selection.cityId : cycleId(cities, selection.cityId)!;
    return { kind: 'city', label: `城市 ${cityId} 需要生产 ›`, cityId };
  }
  const units = idleUnitIds(view).filter(id => !reviewed.has(id));
  if (units.length) return { kind: 'unit', label: `单位需要命令（${units.length}）›`, unitId: cycleId(units, selection.unitId)!, remaining: units.length };
  return { kind: 'ready', label: `第 ${view.round} 轮 · 下一回合 ›` };
}
