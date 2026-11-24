// Playtest 2026-11b batches C and D (presentation only): the rival's foggy arrival (N2), the duel conditions (O2), raid reach, the
// research queue, the conference reminder (O3). Everything reads the PlayerView (plus the client's own memory of the warning), so
// the hidden live position of a rival never reaches the marks, cards or buttons.
import { expect, test } from 'vitest';
import { GameSession } from '../../src/app/session.ts';
import { LEADER_IDS } from '../../src/content/leaders.ts';
import { contentFor } from '../../src/content/units.ts';
import type { TechId } from '../../src/content/economy.ts';
import { hexDistance, hexToIndex, indexToHex, offsetToHex } from '../../src/core/hex.ts';
import type { GameSetup, MapUnit, PlayerView } from '../../src/core/model.ts';
import { observe } from '../../src/core/vision.ts';
import { RivalMemory, duelBarState, duelConditions, rivalMemory, rivalTrail, rivalTrailEntities } from '../../src/browser/rival-tracker.ts';
import { ResearchQueue, conferenceDue } from '../../src/browser/client-plans.ts';
import { worldCards } from '../../src/browser/world-cards.ts';
import { depthWorldCards } from '../../src/browser/late-game-ui.ts';
import { buildScene } from '../../src/browser/render/scene.ts';
import { turnReminders, turnStep } from '../../src/browser/turn-button.ts';
import { approachTile } from '../../src/browser/world-goto.ts';

// The second playtest's opening (verify-rival.ts): seed 21, 小刚 + 小火龙; the rival's first visit arrives in fog on round 8 at (33, 17).
const seed = 21, human = 'brock' as const;
const ai = LEADER_IDS.filter(id => id !== human).map((id, index) => ({ id, key: (Math.imul(seed + 1, 2654435761) ^ Math.imul(index + 7, 40503)) >>> 0 }))
  .sort((a, b) => a.key - b.key || a.id.localeCompare(b.id)).map(item => item.id);
const setup: GameSetup = { expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion: 27, seed, width: 40, height: 26, roundLimit: 200,
  players: [{ id: 0, controller: 'human', starterId: 'charmander', leaderId: human }, ...[1, 2, 3].map(id => ({ id, controller: 'ai' as const, personality: 'expansion' as const, leaderId: ai[id - 1] }))] };

test('N2: a rival arriving in fog keeps its "已到达" mark on the warned tile, then is shown where last seen — never where it is now', () => {
  const session = new GameSession(setup), content = contentFor(setup), memory = rivalMemory;
  memory.clear();
  const views: Record<number, PlayerView> = {};
  while (session.getView().round < 12) {
    const view = session.getView();
    memory.observe(view);
    views[view.round] = view;
    if (view.round >= 8 && view.round <= 9) {
      // In fog: the trail is the warned tile (the player saw it in the warning), whatever the hidden unit does.
      const trail = rivalTrail(view)!, warned = hexToIndex(offsetToHex({ col: 33, row: 17 }), view.map)!;
      expect(trail.visible).toHaveLength(0);
      expect(trail.arrival?.tileIndex).toBe(warned);
      expect(trail.where).toContain('已到达');
      const scene = buildScene({ view });
      expect(scene.badges.some(badge => badge.index === warned && badge.kind === 'sprite' && badge.warning)).toBe(true);
      const card = worldCards(view, content).find(item => item.id === 'rival')!;
      expect(card.tileIndex).toBe(warned);
      expect(card.status).toContain('已到达');
      expect(card.tip).toContain('对决条件');
      expect(rivalTrailEntities(view, warned).map(entity => entity.title).join()).toContain('已到达');
      // Moving the hidden rival elsewhere in the authority changes nothing the viewer is shown.
      const state = session.getState(), id = view.expansion!.rivals!.activeUnitIds[0], unit = state.units[id] as MapUnit;
      const hidden = state.map.tiles.map((_, index) => index).find(index => state.map.tiles[index] === 'grassland' && !view.visibleTileIds.includes(index)
        && !Object.values(state.units).some(other => (other as MapUnit).position && hexToIndex((other as MapUnit).position, state.map) === index))!;
      unit.position = indexToHex(hidden, state.map);
      const shifted = observe(state, 0, content);
      expect(JSON.stringify(rivalTrail(shifted))).toBe(JSON.stringify(trail));
      expect(JSON.stringify(buildScene({ view: shifted }).badges)).toBe(JSON.stringify(scene.badges));
      // The duel button explains why and offers to go to the warned tile.
      const own = view.units.find(item => item.ownerId === 0 && item.kind === 'pokemon')!;
      const bar = duelBarState(view, own, content)!;
      expect(bar.goTo).toBe(warned);
      expect(bar.detail).toContain('✗ 这次登场的 1 只都在视野里');
    }
    session.issue({ type: 'EndTurn' });
  }
  const seen = views[11]!, trail = rivalTrail(seen)!;
  expect(trail.visible).toHaveLength(1);
  expect(trail.arrival).toBeNull();
  expect(duelConditions(seen, trail)[0].ok).toBe(true);
  // Out of sight again: the remembered tile (lastKnownUnits), drawn dim, and the duel button points there.
  const lost = structuredClone(seen), id = lost.expansion!.rivals!.activeUnitIds[0];
  const last = hexToIndex(lost.units.find(unit => unit.id === id)!.position, lost.map)!;
  lost.units = lost.units.filter(unit => unit.id !== id);
  lost.expansion!.rivals!.sightings = [];
  lost.visibleTileIds = lost.visibleTileIds.filter(index => index !== last);
  const remembered = rivalTrail(lost)!;
  expect(remembered.remembered.map(spot => spot.tileIndex)).toEqual([last]);
  expect(remembered.arrival).toBeNull();
  expect(buildScene({ view: lost }).badges.some(badge => badge.index === last && badge.dim)).toBe(true);
  const own = lost.units.find(unit => unit.ownerId === 0 && unit.kind === 'pokemon' && hexToIndex(unit.position, lost.map) !== last)!;
  expect(duelBarState(lost, own, content)!.goTo).toBe(last);
  // A fresh client (a loaded save) has no memory of the warning: no arrival mark, no invented position.
  const fresh = new RivalMemory();
  expect(rivalTrail(views[9]!, fresh)!.arrival).toBeNull();
  expect(rivalTrail(views[9]!, fresh)!.target).toBeNull();
  memory.clear();
}, 300_000);

test('research queue: a locked tech queues its missing prerequisites first; removing one drops what needs it', () => {
  const session = new GameSession(setup), view = session.getView(), content = contentFor(setup), queue = new ResearchQueue();
  const techs = Object.keys(content.techs) as TechId[];
  const locked = techs.find(id => (content.techs[id]!.requires ?? []).some(requirement => (content.techs[requirement]!.requires ?? []).length))!;
  queue.add(view, locked, content);
  const list = queue.list();
  expect(list.at(-1)).toBe(locked);
  for (const [index, id] of list.entries()) for (const requirement of content.techs[id]!.requires ?? []) expect(list.indexOf(requirement)).toBeLessThan(index);
  expect(queue.next(view, content)).toBe(list.find(id => (content.techs[id]!.requires ?? []).length === 0));
  queue.remove(list[0], content);
  expect(queue.list()).not.toContain(locked);
  queue.clear();
  expect(queue.list()).toEqual([]);
});

test('O3: an eligible, unregistered player in the 5 rounds before a season gets a to-do, and the end-turn button routes there once a round', () => {
  const session = new GameSession(setup), view = session.getView(), content = contentFor(setup);
  const championship = view.expansion!.civilization.championship;
  championship.nextRound = view.round + 3;
  const starter = view.units.find(unit => unit.ownerId === 0 && unit.kind === 'pokemon')!;
  view.units.push(...[1, 2, 3, 4, 5].map(k => ({ ...starter, id: 9000 + k })));
  expect(conferenceDue(view)).toBe(3);
  view.economy.player.research.techId = 'domestication' as TechId;
  const reminders = turnReminders(view, content);
  expect(reminders.map(item => item.target)).toContain('conference');
  // Earlier steps (a dedication, research, a charter) still come first; the conference goes before idle cities and units.
  const step = turnStep(view, reminders.filter(item => item.target.startsWith('#') === false), { unitId: null, cityId: null }, new Set());
  expect(step.kind).toBe('conference');
  expect(turnStep(view, reminders, { unitId: null, cityId: null }, new Set(), { conference: true }).kind).not.toBe('conference');
  championship.nextRound = view.round + 6;
  expect(conferenceDue(view)).toBeNull();
});

test('raids: a known den shows who gets there and when, with a go-to; an unexplored one says so without a distance', () => {
  const session = new GameSession(setup), view = session.getView(), content = contentFor(setup);
  const starter = view.units.find(unit => unit.ownerId === 0 && unit.kind === 'pokemon')!;
  const target = view.knowledge.exploredTileIds.find(index => view.map.tiles[index] === 'grassland' && hexDistance(indexToHex(index, view.map), starter.position, view.map) === 3)!;
  const approach = approachTile(view, target, content)!;
  expect(approach.unitId).toBeGreaterThan(0);
  view.expansion!.raids = { nextRound: null, held: 0, pending: null, active: { unitId: null, tileIndex: target, endsAtRound: view.round + 3, damage: {}, speciesId: 'charmander', maxHp: 100 } };
  const known = depthWorldCards(view, content).find(card => card.id === 'raid')!;
  expect(known.status).toMatch(/约 \d+ 轮到|已在旁边/);
  view.expansion!.raids.active!.tileIndex = null;
  const far = depthWorldCards(view, content).find(card => card.id === 'raid')!;
  expect(far.status).toContain('未探索 · 位置未知');
  expect(far.goTo).toBeUndefined();
  expect(far.tileIndex).toBeUndefined();
});
