// Playtest 2026-11b N2 / O2: where the own rival is, as far as the viewer legitimately knows. Presentation only.
//
// What the view exposes: before a visit, the target's own ledger carries the warned arrival tile (`pending`); after the arrival it
// is gone, and the rival Pokémon are seen only on visible tiles (`sightings`) or remembered where they were last seen
// (`knowledge.lastKnownUnits`, which the authority drops once that tile is seen empty). The client keeps the warned tile and the
// target city of the current visit in memory (like go-to orders: never saved, cleared on new game / load / replay), so after a
// foggy arrival the map keeps a "劲敌已到达" marker on a tile the player was already shown. The live position of an unseen rival is
// never read: everything below comes from the PlayerView and that memory.
import { contentForView } from '../content/units.ts';
import type { Content } from '../content/units.ts';
import type { SpeciesId } from '../content/species.ts';
import { viewDuelCandidates, viewRivalLineup } from '../core/rival-duels.ts';
import { hexDistance, hexToIndex } from '../core/hex.ts';
import { tileCoords } from './tile-coords.ts';
import type { MapUnit, PlayerView } from '../core/model.ts';
import type { TileEntity } from './tile-info.ts';

/** The warning of one visit, as the target saw it: the arrival tile, the round and the warned city. */
export type RivalWarning = { visit: number; tileIndex: number; round: number; cityId: number; seen: boolean };

/** Client memory of the own rival's warning (one visit at a time). */
export class RivalMemory {
  private warning: RivalWarning | null = null;
  /** Call on every refresh: notes a warning, and whether any rival Pokémon of the visit has been in sight. */
  observe(view: PlayerView): void {
    const rivals = view.expansion?.rivals;
    if (!rivals) return;
    if (rivals.pending) {
      const visit = rivals.encounter + 1;
      if (this.warning?.visit !== visit || this.warning.tileIndex !== rivals.pending.tileIndex)
        this.warning = { visit, tileIndex: rivals.pending.tileIndex, round: rivals.pending.round, cityId: rivals.pending.cityId, seen: false };
      return;
    }
    const current = this.current(view);
    if (current && (viewRivalLineup(view).length || rivals.activeUnitIds.some(id => view.knowledge.lastKnownUnits[id]))) current.seen = true;
  }
  /** The warning of the visit now on the map (null before it, after it, or when this client never saw the warning). */
  current(view: PlayerView): RivalWarning | null {
    const rivals = view.expansion?.rivals;
    return rivals && this.warning && !rivals.pending && rivals.encounter === this.warning.visit && rivals.activeUnitIds.length ? this.warning : null;
  }
  clear(): void { this.warning = null; }
}
/** The browser's memory (main.ts observes every refresh and clears it with the go-to orders). */
export const rivalMemory = new RivalMemory();


export type RivalSpot = { tileIndex: number; round: number; speciesId?: SpeciesId; unitId?: number };
/**
 * The own rival's visit as the viewer knows it. `visible`: rival Pokémon in sight; `remembered`: the others where they were last
 * seen; `arrival`: the warned tile, while nothing of this visit has been seen and that tile is not seen empty; `city`: the warned city
 * (the rival walks toward it). `target`: the best tile to point at (in sight, then last seen, then the arrival, then the city).
 */
export type RivalTrail = { total: number; visible: (MapUnit & { kind: 'pokemon' })[]; remembered: RivalSpot[]; arrival: RivalSpot | null;
  city: RivalSpot | null; missing: number; target: RivalSpot | null; where: string; short: string };
export function rivalTrail(view: PlayerView, memory: RivalMemory = rivalMemory): RivalTrail | null {
  const rivals = view.expansion?.rivals;
  if (!rivals || !rivals.activeUnitIds.length) return null;
  const visible = viewRivalLineup(view), seen = new Set(visible.map(unit => unit.id)), visibleTiles = new Set(view.visibleTileIds);
  const remembered = rivals.activeUnitIds.filter(id => !seen.has(id)).flatMap(id => {
    const known = view.knowledge.lastKnownUnits[id], index = known ? hexToIndex(known.position, view.map) : null;
    return known && index !== null ? [{ tileIndex: index, round: known.lastSeenRound, unitId: id, ...(known.kind === 'pokemon' ? { speciesId: known.speciesId } : {}) }] : [];
  }).sort((a, b) => b.round - a.round || a.tileIndex - b.tileIndex);
  const warning = memory.current(view);
  const arrival = warning && !warning.seen && !visible.length && !remembered.length && !visibleTiles.has(warning.tileIndex)
    ? { tileIndex: warning.tileIndex, round: warning.round } : null;
  const home = warning ? view.economy.cities.find(city => city.id === warning.cityId) : undefined;
  const city = home ? { tileIndex: hexToIndex(home.position, view.map)!, round: view.round } : null;
  const own = view.units.filter(unit => unit.ownerId === view.playerId);
  const nearestVisible = [...visible].sort((a, b) => Math.min(...own.map(item => hexDistance(item.position, a.position, view.map)), 99)
    - Math.min(...own.map(item => hexDistance(item.position, b.position, view.map)), 99) || a.id - b.id)[0];
  const target = nearestVisible ? { tileIndex: hexToIndex(nearestVisible.position, view.map)!, round: view.round, unitId: nearestVisible.id } : remembered[0] ?? arrival ?? city;
  const missing = rivals.activeUnitIds.length - visible.length;
  const where = !missing ? '全部在视野里'
    : remembered.length ? `${missing} 只不在视野里 · 第 ${remembered[0].round} 轮见于 ${tileCoords(remembered[0].tileIndex, view.map)}`
    : arrival ? `已到达 ${tileCoords(arrival.tileIndex, view.map)}（预告的登场点，在迷雾里）`
    : visible.length ? `${missing} 只不在视野里 · 位置不明`
    : city ? `位置不明 · 正朝${view.economy.player.headquartersCityId === warning!.cityId ? '首都' : `城市 ${warning!.cityId}`}前进` : '位置不明';
  const short = !missing ? '在视野里' : remembered.length ? `第 ${remembered[0].round} 轮见于 ${tileCoords(remembered[0].tileIndex, view.map)}`
    : arrival ? `登场点 ${tileCoords(arrival.tileIndex, view.map)} · 迷雾中` : '位置不明';
  return { total: rivals.activeUnitIds.length, visible, remembered, arrival, city, missing, target, where, short };
}

/** O2: the duel's conditions, each met or not (the authority's own rules, read from the view: rival-duels.ts). */
export function duelConditions(view: PlayerView, trail: RivalTrail | null = rivalTrail(view)): { ok: boolean; text: string }[] {
  const rivals = view.expansion?.rivals;
  if (!rivals || !trail) return [];
  const { candidates, adjacent, gate } = viewDuelCandidates(view);
  return [
    { ok: trail.missing === 0, text: `这次登场的 ${trail.total} 只都在视野里（${trail.total - trail.missing}/${trail.total}）` },
    { ok: candidates.length >= trail.total, text: `你有 ${trail.total} 只本轮未行动的宝可梦在劲敌 2 格内（${Math.min(candidates.length, trail.total)}/${trail.total}）` },
    { ok: adjacent.length > 0 || gate, text: '其中至少一只与劲敌相邻；劲敌在你的城旁时，城 2 格内的也可以' },
    { ok: rivals.duelRound !== view.round, text: '每轮只能对决一次' },
  ];
}
export const conditionLines = (conditions: readonly { ok: boolean; text: string }[]) => conditions.map(item => `${item.ok ? '✓' : '✗'} ${item.text}`).join('\n');

/**
 * The unit bar's 对决 button for a Pokémon while the own rival is on the map. `goTo`: the duel is blocked because rival Pokémon
 * are out of sight, so the button sets a go-to order toward where they were last known (null target: nowhere known, disabled).
 * Null when the button should not appear (no visit, or the unit is out of reach while the whole team is in sight, as before).
 */
export function duelBarState(view: PlayerView, unit: MapUnit, content: Content = contentForView(view)):
  { goTo: number | null; reason: string | null; title: string; detail: string } | null {
  void content;
  if (unit.kind !== 'pokemon') return null;
  const trail = rivalTrail(view);
  if (!trail) return null;
  const conditions = conditionLines(duelConditions(view, trail));
  if (trail.missing > 0) {
    const tile = trail.target?.tileIndex ?? null, here = hexToIndex(unit.position, view.map);
    const reason = tile === null ? `劲敌这次登场的 ${trail.total} 只要全部在视野里才能对决；现在${trail.where}。` : tile === here ? `劲敌这次登场的 ${trail.total} 只要全部在视野里才能对决：它们不在这里，派宝可梦向四周侦察。` : null;
    return { goTo: reason ? null : tile, reason, title: `对决 · 劲敌不全在视野里：前往 ${tile === null ? '' : tileCoords(tile, view.map)}`,
      detail: `${trail.where}。点击设路标前往那里（W 同款多回合前往），看见全部劲敌后再对决。\n对决条件：\n${conditions}` };
  }
  if (!viewDuelCandidates(view).candidates.includes(unit.id)) return null;
  return { goTo: null, reason: null, title: '', detail: `对决条件：\n${conditions}` };
}

/** The tile inspector's lines for the rival marks drawn on `index` (arrival in fog, last seen); none elsewhere. */
export function rivalTrailEntities(view: PlayerView, index: number): TileEntity[] {
  const trail = rivalTrail(view), name = view.expansion?.rivals?.name ?? '';
  if (!trail) return [];
  const entities: TileEntity[] = [];
  if (trail.arrival?.tileIndex === index) entities.push({ kind: 'rival', tone: 'enemy', title: `⚠ 劲敌${name}已到达`, subtitle: `第 ${trail.arrival.round} 轮登场 · 预告的登场点，在迷雾里`,
    lines: [`这次登场 ${trail.total} 只。它们从这里出发，朝你的城市前进；看不见时位置不会更新。`], hint: '派宝可梦到附近看清它们：对决要这次登场的劲敌全部在视野里。' });
  for (const spot of trail.remembered.filter(item => item.tileIndex === index)) entities.push({ kind: 'rival', tone: 'enemy', title: `劲敌${name}的宝可梦（第 ${spot.round} 轮所见）`,
    subtitle: '最后所见位置，现在不在视野里', lines: [`${spot.speciesId ? `${contentForView(view).species[spot.speciesId]?.name ?? ''} · ` : ''}它可能已经离开这里。`], hint: '派宝可梦到附近看清它：对决要这次登场的劲敌全部在视野里。' });
  return entities;
}
