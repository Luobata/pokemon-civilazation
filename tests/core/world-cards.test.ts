// depth-v26 §6 world page cards and victory banners (presentation only): the cards read the PlayerView alone, so hidden
// sites never reach them; the banners are complete pixel grids.
import { expect, test } from 'vitest';
import { contentFor, contentForView } from '../../src/content/units.ts';
import { rivalStayRounds } from '../../src/content/world24-tuning.ts';
import { RULE_QUERIES } from '../../src/ai/query.ts';
import { planNext } from '../../src/ai/plan.ts';
import { createGame } from '../../src/core/game.ts';
import { observe } from '../../src/core/vision.ts';
import { step } from '../../src/core/step.ts';
import type { Command, GameSetup, GameState } from '../../src/core/model.ts';
import { worldCards, worldCardsMarkup } from '../../src/browser/world-cards.ts';
import { BANNER_HEIGHT, BANNER_IDS, BANNER_WIDTH, bannerGrid, bannerUrl } from '../../src/browser/victory-banners.ts';
import { UI_ICON_NAMES } from '../../src/browser/ui-icons.ts';

const setup: GameSetup = { seed: 3, width: 24, height: 16, roundLimit: 100, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion: 24,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, ...[1, 2, 3].map(id => ({ id, controller: 'ai' as const, personality: 'aggressive' as const }))] };
/** AI plays every seat until seat 0's turn in `round`. */
function playTo(round: number, game: GameSetup = setup): GameState {
  const content = contentFor(game);
  let state = createGame(game, content);
  while (!(state.round >= round && state.activePlayerId === 0)) {
    const view = observe(state, state.activePlayerId, content);
    let command: Command = planNext(view, { ...RULE_QUERIES, content }, []);
    let result = step(state, command, content);
    if (!result.ok) { command = { actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'EndTurn' } }; result = step(state, command, content); }
    if (!result.ok) throw new Error(result.reason);
    state = result.state;
  }
  return state;
}

test('world cards point only at tiles the viewer knows, and hidden changes do not alter them', () => {
  const state = playTo(14), content = contentFor(setup), view = observe(state, 0, content);
  const known = new Set([...view.visibleTileIds, ...view.knowledge.exploredTileIds]), cards = worldCards(view, content);
  expect(cards.map(card => card.id)).toEqual(expect.arrayContaining(['conference', 'rival']));
  for (const card of cards) if (card.tileIndex !== undefined) expect(known.has(card.tileIndex), `${card.id} → ${card.tileIndex}`).toBe(true);
  // Move every unseen gym, nest and wild Pokémon onto another unseen tile: seat 0's cards stay byte-identical.
  const hidden = state.map.tiles.map((_, index) => index).filter(index => !known.has(index));
  expect(hidden.length).toBeGreaterThan(0);
  const shifted = structuredClone(state);
  for (const gym of shifted.expansion!.gymCircuit!.gyms) if (!known.has(gym.tileIndex)) gym.tileIndex = hidden[(hidden.indexOf(gym.tileIndex) + 1) % hidden.length];
  for (const nest of Object.values(shifted.expansion!.world.nests)) if (!known.has(nest.tileIndex)) { nest.hp = 1; nest.nextSpawnRound = 99; }
  shifted.players[1].gold += 500;
  expect(JSON.stringify(worldCards(observe(shifted, 0, content), content))).toBe(JSON.stringify(cards));
  // Most urgent first; every card renders with a named locate button or none.
  expect(cards.map(card => card.urgency)).toEqual([...cards.map(card => card.urgency)].sort((a, b) => a - b));
  const markup = worldCardsMarkup(cards, label => `<button>${label}</button>`);
  for (const card of cards.filter(item => item.tileIndex !== undefined)) expect(markup).toContain(`data-locate-tile="${card.tileIndex}" aria-label="定位：`);
}, 120_000);

test('v25: gym, rival and catch cards read the regional content', () => {
  const v25: GameSetup = { ...setup, gameplayVersion: 25 };
  const state = playTo(7, v25), content = contentFor(v25), view = observe(state, 0, content);
  expect(contentForView(view)).toBe(content);
  const cards = worldCards(view);
  expect(cards.map(card => card.id)).toEqual(expect.arrayContaining(['gym', 'rival', 'conference']));
  const rival = cards.find(card => card.id === 'rival')!, ledger = view.expansion!.rivals!;
  expect(ledger.pending).toBeDefined();
  expect(rival.tip).toContain(`停留 ${rivalStayRounds(content, ledger.encounter)} 轮后离开`);
  const capture = cards.find(card => card.id === 'capture');
  expect(capture).toBeDefined();
  expect(Object.values(content.species).map(species => species.name)).toContain(capture!.title);
  for (const unit of view.units) if (unit.ownerId === null && unit.kind === 'pokemon') expect(view.regionalDex).toContain(unit.speciesId);
}, 120_000);

test('victory banners are full 120×24 pixel grids with a palette colour per cell; the new kit icons exist', () => {
  for (const id of BANNER_IDS) {
    const { rows, palette } = bannerGrid(id);
    expect(rows).toHaveLength(BANNER_HEIGHT);
    for (const row of rows) expect(row.length, id).toBe(BANNER_WIDTH);
    for (const cell of new Set(rows.join(''))) if (cell !== '.') expect(palette[cell], `${id} ${cell}`).toMatch(/^#[0-9A-F]{6}$/i);
    expect(rows.join('').replace(/\./g, '').length, `${id} is fully painted`).toBe(BANNER_WIDTH * BANNER_HEIGHT);
    expect(bannerUrl(id)).toMatch(/^data:image\/svg\+xml,/);
  }
  for (const name of ['locate', 'rival', 'trainer', 'tablet', 'flag'] as const) expect(UI_ICON_NAMES).toContain(name);
});
