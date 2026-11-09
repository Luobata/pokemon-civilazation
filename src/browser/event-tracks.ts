// Presentation batch 3 (docs/design/review-2026-11/3-audio-visual.md V8 / V9): map feedback for big events,
// built only from the presented event and the viewer's PlayerView. Pulses are non-blocking (they never hold the
// event queue or input); form changes play like an evolution, one after another with the other unit actions.
import { DISTRICTS } from '../content/districts.ts';
import { TYPE_COLORS } from '../content/type-colors.ts';
import { indexToHex } from '../core/hex.ts';
import type { Hex } from '../core/hex.ts';
import type { PlayerView, VisibleEvent } from '../core/model.ts';
import { formTrack, pulseTrack, routeTrack } from './render/animation.ts';
import type { FormKind, Track } from './render/animation.ts';
import { DISTRICT_COLORS, ownerColor } from './render/canvas2d.ts';

type Payload = VisibleEvent['payload'];
const GOLD = '#F2C14E', ALARM = '#E5554A', STONE = '#7FD8C0';
/** Colours of the four era forms; Tera uses its chosen type's colour. */
export const FORM_COLORS: Record<FormKind, string> = { mega: '#FFFDF7', dynamax: '#E5554A', tera: '#B8E3F0', zMove: GOLD };

const unitAt = (view: PlayerView, id: number) => view.units.find(unit => unit.id === id)?.position;
const cityAt = (view: PlayerView, id: number) => view.cities.find(city => city.id === id)?.position;

/** Tiles a big event happens on (for the off-screen rule); empty when the viewer cannot place it. */
export function bigEventTiles(payload: Payload, view: PlayerView): Hex[] {
  const known = (...tiles: (Hex | undefined)[]) => tiles.filter((hex): hex is Hex => hex !== undefined);
  switch (payload.type) {
    case 'CityFounded': return [payload.position];
    case 'DistrictCompleted': return [indexToHex(payload.tileIndex, view.map)];
    case 'UnitPromoted': case 'WorldStoneEvolution': case 'EraAbilityUsed': return known(unitAt(view, payload.unitId));
    case 'TradeRouteEstablished': return known(cityAt(view, payload.fromCityId), cityAt(view, payload.toCityId));
    case 'WildSpawned': case 'WorldNestSpawned': case 'WorldRampageStruckCity': return [payload.position];
    default: return [];
  }
}

/** The V8 pulse or V9 form track for an event, or null (not a big event, or nothing the viewer can place). */
export function bigEventTrack(payload: Payload, view: PlayerView, key: string, options: { motion: boolean; onFinish?(): void }): Track | null {
  const live = (id: number) => (context: { unitPosition(id: number): Hex | undefined }) => context.unitPosition(id);
  switch (payload.type) {
    case 'CityFounded': return pulseTrack(key, payload.position, ownerColor('playerId' in payload ? payload.playerId as number : view.playerId), '建城', 'star');
    case 'DistrictCompleted': return pulseTrack(key, indexToHex(payload.tileIndex, view.map), DISTRICT_COLORS[payload.kind], DISTRICTS[payload.kind].name);
    case 'UnitPromoted': return unitAt(view, payload.unitId) ? pulseTrack(key, live(payload.unitId), GOLD, '晋升', 'chevron') : null;
    case 'WorldStoneEvolution': return unitAt(view, payload.unitId) ? pulseTrack(key, live(payload.unitId), STONE, '进化', 'star') : null;
    case 'TradeRouteEstablished': {
      const from = cityAt(view, payload.fromCityId), to = cityAt(view, payload.toCityId);
      return from && to ? routeTrack(key, from, to, view.map) : null;
    }
    case 'WildSpawned': return pulseTrack(key, payload.position, ALARM, '野生出现', 'alert');
    case 'WorldNestSpawned': return pulseTrack(key, payload.position, ALARM, '巢穴出动', 'alert');
    case 'WorldRampageStruckCity': return pulseTrack(key, payload.position, ALARM, '暴走袭城', 'alert');
    case 'EraAbilityUsed': {
      const unit = view.units.find(item => item.id === payload.unitId);
      if (!unit) return null;
      const color = payload.ability === 'tera' && payload.typeId ? TYPE_COLORS[payload.typeId] : FORM_COLORS[payload.ability];
      return formTrack(key, unit, payload.ability, color, options);
    }
    default: return null;
  }
}
