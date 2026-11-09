import { RULE_QUERIES } from '../../../src/ai/query.ts';
import { planNext } from '../../../src/ai/plan.ts';
import { rememberCityRejection } from '../../../src/ai/memory.ts';
import type { RejectedCitySite } from '../../../src/ai/memory.ts';
import { GameSession } from '../../../src/app/session.ts';
import { contentFor } from '../../../src/content/units.ts';
import { isNight } from '../../../src/content/era-abilities.ts';
import type { Hex } from '../../../src/core/hex.ts';
import type { GameSetup } from '../../../src/core/model.ts';

// Presentation batch 3 (review 3-audio-visual V8–V11, A3, A5): real v23 games on the wrapping 24×16 map with the full
// era progression (so era forms unlock). The AI plays every seat through the normal GameSession, so each save replays
// exactly; nothing is patched. Each situation is saved at player 0's turn, before the command (or end turn) that the
// test then issues with real input.
const setupFor = (seed: number): GameSetup => ({ seed, width: 24, height: 16, roundLimit: 100, expansionVersion: 1, eraProgression: 'full-v1', gameplayVersion: 23,
  players: [{ id: 0, controller: 'human', starterId: 'charmander', leaderId: 'oak' },
    { id: 1, controller: 'ai', personality: 'aggressive', leaderId: 'lance' }, { id: 2, controller: 'ai', personality: 'aggressive', leaderId: 'giovanni' }] });

type Base = { save: string; seed: number; round: number };
/** found: player 0's settler `unitId` can found a city where it stands. */
export type FoundFixture = Base & { unitId: number; position: Hex };
/** form: player 0's AI chose this era form for `unitId` (the test clicks the same button). */
export type FormFixture = Base & { unitId: number; position: Hex; action: 'MegaEvolve' | 'Dynamax' | 'PrimeZMove' | 'Terastallize' };
/** wonder: ending this turn completes one of player 0's legendary wonders in `cityId`. */
export type WonderFixture = Base & { cityId: number; city: Hex };
/** night: ending this turn (round 2, day) brings the first night. */
export type NightFixture = Base;
/** ending: ending this turn ends the game; `won` whether player 0 is among the winners. */
export type EndingFixture = Base & { won: boolean };
type Found = { found?: FoundFixture; form?: FormFixture; wonder?: WonderFixture; night?: NightFixture; ending?: EndingFixture };
/** Seeds known to reach each situation early (searched first; the search falls back to seeds 1–10). */
const PREFERRED: Record<keyof Found, number> = { found: 1, form: 2, wonder: 8, night: 1, ending: 6 };
const FORMS = new Set(['MegaEvolve', 'Dynamax', 'PrimeZMove', 'Terastallize']);

function search(seed: number, found: Found, need: keyof Found) {
  const setup = setupFor(seed), content = contentFor(setup);
  const driver = new GameSession(setup);
  const memory: RejectedCitySite[] = [];
  while (!found[need]) {
    const state = driver.getState();
    if (state.outcome) return;
    const view = driver.getView();
    const command = planNext(view, { ...RULE_QUERIES, content }, memory);
    const mine = state.activePlayerId === 0, action = command.action;
    const save = mine ? driver.save() : null;
    if (save && !found.night && view.round === 2 && !isNight(2) && isNight(3) && view.expansion?.eraAbilities) found.night = { save, seed, round: view.round };
    if (save && action.type === 'FoundCity' && !found.found) {
      const unit = view.units.find(item => item.id === action.unitId)!;
      found.found = { save, seed, round: view.round, unitId: unit.id, position: unit.position };
    }
    if (save && FORMS.has(action.type) && 'unitId' in action && !found.form) {
      const unit = view.units.find(item => item.id === action.unitId)!;
      found.form = { save, seed, round: view.round, unitId: unit.id, position: unit.position, action: action.type as FormFixture['action'] };
    }
    let result = driver.issue(action);
    if (!result.ok) {
      rememberCityRejection(memory, view, command, result.reason);
      result = driver.issue({ type: 'EndTurn' });
      if (!result.ok) throw new Error(`Big-event fixture rejected EndTurn: ${result.reason}`);
    }
    if (save && action.type === 'EndTurn') {
      const queue = driver.presentationQueue.map(event => event.payload);
      const wonder = queue.find(payload => payload.type === 'LegendWonderCompleted' && payload.playerId === 0);
      if (wonder && wonder.type === 'LegendWonderCompleted' && !found.wonder) {
        const cityId = driver.getView().expansion!.legends!.wonders.find(item => item.legendId === wonder.legendId)!.cityId!;
        found.wonder = { save, seed, round: view.round, cityId, city: driver.getState().cities[cityId].position };
      }
      const ended = queue.find(payload => payload.type === 'GameEnded');
      if (ended && ended.type === 'GameEnded' && !found.ending) found.ending = { save, seed, round: view.round, won: ended.outcome.winners.includes(0) };
    }
    driver.skipAnimations();
  }
}

const found: Found = {};
function find<K extends keyof Found>(need: K): NonNullable<Found[K]> {
  const seeds = [PREFERRED[need], ...Array.from({ length: 10 }, (_, index) => index + 1).filter(seed => seed !== PREFERRED[need])];
  for (const seed of seeds) { if (found[need]) break; search(seed, found, need); }
  const fixture = found[need];
  if (!fixture) throw new Error(`No v23 game reached the ${need} situation for player 0`);
  return fixture as NonNullable<Found[K]>;
}
export const foundFixture = (): FoundFixture => find('found');
export const formFixture = (): FormFixture => find('form');
export const wonderFixture = (): WonderFixture => find('wonder');
export const nightFixture = (): NightFixture => find('night');
export const endingFixture = (): EndingFixture => find('ending');
