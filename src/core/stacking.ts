// Gameplay v26 C2 (docs/design/depth-v26.md §7.2, option 7A): one Pokémon and one logistics unit of the same owner may share a tile.
// Stub for the tile-sharing lane: the single predicate the movement rules ask (the path search and the authority's Move check);
// false = the pre-v26 rule (every unit blocks).
import type { Content } from '../content/units.ts';

type Occupant = { kind: string; ownerId: number | null };
/** Whether `mover` may enter (pass through or stop on) a tile `occupant` stands on. */
export function tileShareAllowed(mover: Occupant, occupant: Occupant, content: Content): boolean {
  void mover; void occupant; void content;
  return false;
}
