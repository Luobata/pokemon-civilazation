// Which music plays, from the viewer's PlayerView and the presented events only (review 3-audio-visual A3 / A5).
//   A5: the map-table theme ("menu") on the game menu (new game, leader choice) and through the opening round;
//       at the end a victory theme or a quiet defeat coda.
//   A3: the war theme comes in layers (intensity 0–3) by how much fighting reached the viewer this turn cycle;
//       in peace, the kit comes forward (intensity 1) when foreign troops gather near the viewer's cities.
import { hexDistance } from '../core/hex.ts';
import type { PlayerView, VisibleEvent } from '../core/model.ts';
import type { MusicMood } from './audio/index.ts';

const atWar = (view: PlayerView) => view.diplomacy.some(pair => pair.status === 'war' && (pair.a === view.playerId || pair.b === view.playerId));

/**
 * The music for the current situation. `menuOpen`: the game menu (new game / leader setup) is on screen.
 * `endingShown`: the game's end has been presented (the ending theme waits for it, not for the final battle).
 */
export function musicMood(view: PlayerView, menuOpen: boolean, endingShown = true): MusicMood {
  if (view.outcome && endingShown) return view.outcome.winners.includes(view.playerId) ? 'victory' : 'defeat';
  if (menuOpen) return 'menu';
  if (atWar(view)) return 'war';
  return view.round <= 1 ? 'menu' : 'peace';
}

/** Foreign civilization Pokémon this close to one of the viewer's cities count as gathering troops. */
export const TENSION_RADIUS = 3;
/** At least this many of them (visible), from a civilization that may declare war now, raise the peace drums. */
export const TENSION_UNITS = 2;

type Payload = VisibleEvent['payload'];

/**
 * War intensity: 0 no fighting, 1 one or two battles involving the viewer, 2 three or more, 3 one of the viewer's cities
 * was attacked. Counted from the start of the viewer's turn through the other players' turns. The level reached holds
 * through the viewer's next turn (the moment they answer it) and then falls one step per quiet turn cycle, so the
 * music calms down gradually instead of cutting.
 */
export class WarIntensity {
  private battles = 0;
  private cityHit = false;
  private carry = 0;

  reset(): void { this.battles = 0; this.cityHit = false; this.carry = 0; }

  /** `involved`: the battle was fought by or against the viewer; `ownCity`: the target is (was) one of the viewer's cities. */
  observe(payload: Payload, view: PlayerView, involved: () => boolean, ownCity: (cityId: number) => boolean): void {
    if (payload.type === 'TurnChanged' && payload.activePlayerId === view.playerId) {
      this.carry = Math.max(this.current(), this.carry - 1);
      this.battles = 0; this.cityHit = false;
    } else if (payload.type === 'BattleResolved' && involved()) {
      this.battles++;
      if (payload.target.kind === 'city' && ownCity(payload.target.id)) this.cityHit = true;
    } else if (payload.type === 'WorldRampageStruckCity' && ownCity(payload.cityId)) this.cityHit = true;
  }

  private current(): number { return this.cityHit ? 3 : this.battles >= 3 ? 2 : this.battles > 0 ? 1 : 0; }

  /** The layer level for the current mood: war 0–3; in peace 1 while troops gather near the viewer's cities, else 0. */
  level(view: PlayerView): number {
    if (atWar(view)) return Math.max(this.current(), this.carry);
    return tension(view) ? 1 : 0;
  }
}

/** Peace with a warning: visible foreign civilization Pokémon massing near the viewer's cities, from a civilization free to declare war. */
export function tension(view: PlayerView): boolean {
  const me = view.playerId;
  const free = new Set(view.diplomacy.filter(pair => pair.status === 'peace' && (pair.a === me || pair.b === me) && pair.cooldownUntilRound <= view.round)
    .map(pair => pair.a === me ? pair.b : pair.a));
  const cities = view.economy.cities.map(city => city.position);
  const near = view.units.filter(unit => unit.kind === 'pokemon' && unit.ownerId !== null && unit.ownerId !== me && free.has(unit.ownerId)
    && cities.some(city => hexDistance(city, unit.position, view.map) <= TENSION_RADIUS));
  return near.length >= TENSION_UNITS;
}
