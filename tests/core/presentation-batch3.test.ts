import { expect, test } from 'vitest';
import { RULE_QUERIES } from '../../src/ai/query.ts';
import { planNext } from '../../src/ai/plan.ts';
import { GameSession } from '../../src/app/session.ts';
import { contentFor } from '../../src/content/units.ts';
import { TYPE_COLORS } from '../../src/content/type-colors.ts';
import type { GameSetup, PlayerView, VisibleEvent } from '../../src/core/model.ts';
import { AMBIENT_FADE_MS, FORM_MS, PULSE_MS, Timeline, WONDER_PAN_MS, WONDER_PILLAR_MS, formTrack, wonderRevealTrack } from '../../src/browser/render/animation.ts';
import type { AnimationFrame } from '../../src/browser/render/animation.ts';
import { bigEventTrack, FORM_COLORS } from '../../src/browser/event-tracks.ts';
import { AmbientTransitions } from '../../src/browser/ambient-transitions.ts';
import { WarIntensity, musicMood, tension } from '../../src/browser/music-director.ts';
import { compileSong } from '../../src/browser/audio/song.ts';
import { VICTORY_SONG } from '../../src/browser/audio/music-victory.ts';
import { DEFEAT_SONG } from '../../src/browser/audio/music-defeat.ts';
import { WAR_SONG } from '../../src/browser/audio/music-war.ts';
import { PEACE_SONG } from '../../src/browser/audio/music-peace.ts';

// Presentation batch 3 (review 3-audio-visual V8–V11, A3, A5): the pure parts, on a real v23 game's PlayerView.
const setup: GameSetup = { seed: 1, width: 24, height: 16, roundLimit: 100, expansionVersion: 1, eraProgression: 'full-v1', gameplayVersion: 23,
  players: [{ id: 0, controller: 'human', starterId: 'charmander', leaderId: 'oak' }, { id: 1, controller: 'ai', personality: 'aggressive', leaderId: 'lance' }] };
function playedTo(round: number): GameSession {
  const driver = new GameSession(setup), content = contentFor(setup);
  while (driver.getState().round < round && !driver.getState().outcome) {
    const result = driver.issue(planNext(driver.getView(), { ...RULE_QUERIES, content }, []).action);
    if (!result.ok) driver.issue({ type: 'EndTurn' });
    driver.skipAnimations();
  }
  return driver;
}
const sample = (track: { sample(elapsed: number, context: { unitPosition(id: number): { q: number; r: number } | undefined }, frame: AnimationFrame): void }, elapsed: number, view?: PlayerView) => {
  const frame: AnimationFrame = { poses: [], effects: [] };
  track.sample(elapsed, { unitPosition: id => view?.units.find(unit => unit.id === id)?.position }, frame);
  return frame;
};

test('V8: big events map to non-blocking pulses with their colour and label; nothing for what the viewer cannot place', () => {
  const view = playedTo(3).getView(), unit = view.units.find(item => item.ownerId === 0)!, city = view.cities.find(item => item.ownerId === 0)!;
  const track = (payload: unknown) => bigEventTrack(payload as VisibleEvent['payload'], view, 'k', { motion: true });
  const founded = track({ type: 'CityFounded', playerId: 0, cityId: city.id, unitId: 1, position: city.position })!;
  expect(founded.blocking).toBe(false);
  expect(founded.duration).toBe(PULSE_MS);
  expect(sample(founded, PULSE_MS / 2).effects[0]).toMatchObject({ kind: 'pulse', label: '建城', color: '#3BA68A', position: city.position });
  const promoted = sample(track({ type: 'UnitPromoted', playerId: 0, unitId: unit.id, trait: 'assault', rank: 1 })!, 100, view).effects[0];
  expect(promoted).toMatchObject({ kind: 'pulse', label: '晋升', icon: 'chevron', position: unit.position });
  expect(sample(track({ type: 'WildSpawned', unitId: 99, position: { q: 1, r: 1 } })!, 100).effects[0]).toMatchObject({ label: '野生出现', icon: 'alert' });
  expect(sample(track({ type: 'DistrictCompleted', playerId: 0, cityId: city.id, orderId: 1, tileIndex: 5, kind: 'gymDistrict', cost: 1, overflow: 0 })!, 100).effects[0]).toMatchObject({ label: '道馆区', color: '#E07A6D' });
  // A unit the viewer cannot see: no pulse.
  expect(track({ type: 'UnitPromoted', playerId: 0, unitId: 99_999, trait: 'assault', rank: 1 })).toBeNull();
  expect(track({ type: 'TechCompleted', playerId: 0 })).toBeNull();
  // A trade route: the dash runs, then the destination pulses.
  const other = view.cities.find(item => item.id !== city.id) ?? city;
  const route = track({ type: 'TradeRouteEstablished', playerId: 0, fromCityId: city.id, toCityId: other.id })!;
  expect(sample(route, 100).effects.map(effect => effect.kind)).toEqual(['route', 'pulse']);
  expect(sample(route, PULSE_MS * .8).effects[1]).toMatchObject({ kind: 'pulse', label: '商路', position: other.position });
  // Non-blocking tracks never make the timeline busy.
  const timeline = new Timeline();
  timeline.add(founded, 0);
  expect(timeline.busy).toBe(false);
  expect(timeline.animating).toBe(true);
});

test('V9: era forms follow the unit; Dynamax grows to 1.5× (not under reduced motion); Tera uses its type colour', () => {
  const view = playedTo(3).getView(), unit = view.units.find(item => item.ownerId === 0 && item.kind === 'pokemon')!;
  const tera = bigEventTrack({ type: 'EraAbilityUsed', playerId: 0, public: true, ability: 'tera', unitId: unit.id, typeId: 'water' }, view, 'k', { motion: true })!;
  expect(sample(tera, 100, view).effects[0]).toMatchObject({ kind: 'form', form: 'tera', color: TYPE_COLORS.water, position: unit.position });
  expect(tera.blocking).not.toBe(false);
  const grow = formTrack('d', unit, 'dynamax', FORM_COLORS.dynamax);
  const scales = Array.from({ length: 19 }, (_, i) => sample(grow, i * FORM_MS / 18, view).poses[0]?.scale ?? 1);
  expect(Math.max(...scales)).toBeCloseTo(1.5, 5);
  expect(scales.at(-1)).toBe(1);
  expect(sample(formTrack('d', unit, 'dynamax', '#f00', { motion: false }), FORM_MS / 2, view).poses).toEqual([]);
  expect(sample(formTrack('m', unit, 'mega', FORM_COLORS.mega), FORM_MS / 2, view).poses).toEqual([]);
});

test('V10: the reveal pans first (camera only during the pan), then the pillar with its horn cue', () => {
  const from = { x: 0, y: 0, zoom: 1 }, to = { x: -400, y: 120, zoom: 1.5 };
  let horn = 0, done = 0;
  const track = wonderRevealTrack({ key: 'w', city: { q: 3, r: 3 }, motion: true, camera: { from, to }, onPillar: () => horn++, onFinish: () => done++ });
  expect(track.duration).toBe(WONDER_PAN_MS + WONDER_PILLAR_MS);
  expect(sample(track, 0).camera).toEqual(from);
  expect(sample(track, WONDER_PAN_MS / 2).effects).toEqual([]);
  expect(sample(track, WONDER_PAN_MS).camera).toEqual(to);
  expect(sample(track, WONDER_PAN_MS + 10).effects[0]).toMatchObject({ kind: 'pillar', burst: true });
  const timeline = new Timeline();
  timeline.add(track, 0);
  // 60 fps frames: the horn sounds when the pan ends, the card callback when the pillar ends.
  for (let now = 0; now < WONDER_PAN_MS - 16; now += 16) timeline.advance(now);
  expect(horn).toBe(0);
  for (let now = WONDER_PAN_MS - 16; now <= WONDER_PAN_MS; now += 16) timeline.advance(now);
  expect(horn).toBe(1);
  expect(done).toBe(0);
  for (let now = WONDER_PAN_MS; now <= track.duration + 16; now += 16) timeline.advance(now);
  expect(done).toBe(1);
  // A stalled main thread (a 600 ms frame gap) pauses the reveal instead of skipping the pan.
  const paced = new Timeline(), stalled = wonderRevealTrack({ key: 'w', city: { q: 3, r: 3 }, motion: true, camera: { from, to } });
  paced.add(stalled, 0);
  paced.sample(0, { unitPosition: () => undefined });
  const after = paced.sample(600, { unitPosition: () => undefined });
  expect(after.camera!.x).toBeGreaterThan(to.x);
  expect(after.camera!.x).toBeLessThan(from.x);
  // Without a camera move (city in view, or reduced motion) only the pillar plays.
  const still = wonderRevealTrack({ key: 'w', city: { q: 3, r: 3 }, motion: false });
  expect(still.duration).toBe(WONDER_PILLAR_MS);
  expect(sample(still, 10).camera).toBeUndefined();
  expect(sample(still, 10).effects[0]).toMatchObject({ kind: 'pillar', burst: false });
});

test('V11: night and weather changes between consecutive views fade; jumps (load, new game) do not', () => {
  const driver = playedTo(2), ambient = new AmbientTransitions(), day = driver.getView();
  expect(day.expansion!.eraAbilities!.night).toBe(false);
  expect(ambient.update(day)).toEqual([]);
  const content = contentFor(setup);
  while (driver.getState().round < 3) {
    const result = driver.issue(planNext(driver.getView(), { ...RULE_QUERIES, content }, []).action);
    if (!result.ok) driver.issue({ type: 'EndTurn' });
  }
  const night = driver.getView();
  expect(night.expansion!.eraAbilities!.night).toBe(true);
  const [fade] = ambient.update(night);
  expect(fade.blocking).toBe(false);
  expect(sample(fade, 0).night).toBe(0);
  expect(sample(fade, AMBIENT_FADE_MS / 2).night).toBeCloseTo(.5, 5);
  expect(sample(fade, AMBIENT_FADE_MS).night).toBe(1);
  // The same view again: nothing new.
  expect(ambient.update(night)).toEqual([]);
  // A jump back to an earlier game (load): adopted without a fade.
  expect(ambient.update(day)).toEqual([]);
  // Weather appearing and leaving between two views fades in and out (the leaving field is drawn as last seen).
  const field = { weather: 'rain' as const, center: night.map.tiles.length ? { q: 2, r: 2 } : { q: 0, r: 0 }, untilRound: night.round + 2, ownerId: 0 };
  const withRain = { ...night, commandSeq: night.commandSeq + 1, expansion: { ...night.expansion!, eraAbilities: { ...night.expansion!.eraAbilities!, fields: [field] } } } as PlayerView;
  const fresh = new AmbientTransitions();
  fresh.update(night);
  const [rainIn] = fresh.update(withRain);
  expect(sample(rainIn, AMBIENT_FADE_MS / 2).weather).toEqual([{ key: 'rain@2,2', alpha: .5 }]);
  const [rainOut] = fresh.update({ ...night, commandSeq: night.commandSeq + 2 });
  const out = sample(rainOut, AMBIENT_FADE_MS / 4).weather![0];
  expect(out.key).toBe('rain@2,2');
  expect(out.alpha).toBeGreaterThan(.5);
  expect(out.field?.color).toBe('#4E86C2');
});

test('A5 / A3: music mood and war intensity from the view and the presented events', () => {
  const view = playedTo(3).getView(), me = view.playerId;
  expect(musicMood({ ...view, round: 1 }, false)).toBe('menu');
  expect(musicMood(view, false)).toBe('peace');
  expect(musicMood(view, true)).toBe('menu');
  const ended = (winners: number[]) => ({ ...view, outcome: { kind: 'score' as const, winners, ranking: [], round: view.round } });
  expect(musicMood(ended([me]), false)).toBe('victory');
  expect(musicMood(ended([me + 1]), true)).toBe('defeat');
  // The ending theme waits until the end has been presented.
  expect(musicMood({ ...ended([me]), round: 5 }, false, false)).toBe('peace');
  const war = { ...view, diplomacy: view.diplomacy.map(pair => ({ ...pair, status: 'war' as const })) };
  expect(musicMood(war, false)).toBe('war');

  const intensity = new WarIntensity(), yes = () => true, no = () => false;
  const battle = (target: { kind: 'unit' | 'city'; id: number }) => ({ type: 'BattleResolved', attackerId: 1, target, positions: [], damage: 1, counterDamage: 0, knockedDownUnitIds: [] }) as unknown as VisibleEvent['payload'];
  expect(intensity.level(war)).toBe(0);
  intensity.observe(battle({ kind: 'unit', id: 2 }), war, yes, no);
  expect(intensity.level(war)).toBe(1);
  intensity.observe(battle({ kind: 'unit', id: 2 }), war, () => false, no); // strangers' fight: ignored
  intensity.observe(battle({ kind: 'unit', id: 2 }), war, yes, no);
  intensity.observe(battle({ kind: 'unit', id: 2 }), war, yes, no);
  expect(intensity.level(war)).toBe(2);
  intensity.observe(battle({ kind: 'city', id: 1 }), war, yes, yes);
  expect(intensity.level(war)).toBe(3);
  // Our next turn: the level holds while we answer, then falls one step per quiet cycle.
  const ourTurn = { type: 'TurnChanged', activePlayerId: me, round: 4 } as VisibleEvent['payload'];
  intensity.observe(ourTurn, war, no, no);
  expect(intensity.level(war)).toBe(3);
  intensity.observe(ourTurn, war, no, no);
  expect(intensity.level(war)).toBe(2);
  intensity.observe(ourTurn, war, no, no);
  expect(intensity.level(war)).toBe(1);
  intensity.observe(ourTurn, war, no, no);
  expect(intensity.level(war)).toBe(0);
  // In peace the level is the tension warning only.
  expect(intensity.level(view)).toBe(tension(view) ? 1 : 0);
  const city = view.economy.cities[0], enemy = view.civilizations.find(civ => civ.id !== me)!.id;
  const massing = { ...view, diplomacy: view.diplomacy.map(pair => ({ ...pair, cooldownUntilRound: 0 })),
    units: [...view.units, ...[901, 902].map(id => ({ ...view.units.find(unit => unit.kind === 'pokemon')!, id, ownerId: enemy, position: city.position }))] } as PlayerView;
  expect(tension(massing)).toBe(true);
  expect(intensity.level(massing)).toBe(1);
});

test('A3 / A5: the new themes and the accent layers compile', () => {
  for (const song of [VICTORY_SONG, DEFEAT_SONG, WAR_SONG, PEACE_SONG]) expect(compileSong(song).bars.length).toBeGreaterThan(0);
  expect(WAR_SONG.accent && PEACE_SONG.accent).toBeTruthy();
  expect(DEFEAT_SONG.drums).toBeUndefined();
});
