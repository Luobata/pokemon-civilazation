// Gameplay v26 faith victory (docs/design/balance/gate-v25.md, fix 3 follow-up): every original rival must follow the faith — a living one in
// one of its cities, an eliminated one in its former capital — so eliminating a non-follower no longer clears the condition. v25 unchanged.
import { expect, test } from 'vitest';
import { contentFor } from '../../src/content/units.ts';
import { FAITH_RULES } from '../../src/content/faith-legends.ts';
import { createGame } from '../../src/core/game.ts';
import { createCity } from '../../src/core/city.ts';
import { step } from '../../src/core/step.ts';
import { resolveFaithRound } from '../../src/core/faith-legends.ts';
import type { GameSetup, GameState } from '../../src/core/model.ts';

const setup = (gameplayVersion: 25 | 26): GameSetup => ({ seed: 12345, width: 24, height: 16, expansionVersion: 1, multiplayer: true, eraProgression: 'simple-v1',
  gameplayVersion, players: [
    { id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'misty' },
    { id: 1, controller: 'human', starterId: 'charmander', leaderId: 'lance' },
    { id: 2, controller: 'human', starterId: 'squirtle', leaderId: 'brock' },
  ] });
/** Civilization 0's faith holds most cities and one of civilization 1's; civilization 2 is eliminated and its former capital is held by 0. */
function table(version: 25 | 26, capitalFollows: boolean): GameState {
  const state = createGame(setup(version)), content = contentFor(state.setup);
  const civ = state.expansion!.civilization.players[0];
  civ.lifetimeOfferings = FAITH_RULES.foundLifetime; civ.offeringPoints = FAITH_RULES.foundCost + 100;
  const result = step(state, { actorId: 0, expectedSeq: state.commandSeq, action: { type: 'FoundFaith', legend: 'lugia', tenets: ['missionaries', 'shrineGold'] } }, content);
  if (!result.ok) throw new Error(result.reason);
  const next = result.state, hq = next.cities[next.players[0].headquartersCityId], faith = next.expansion!.faith!;
  for (let i = 0; i < 6; i++) { next.cities[960 + i] = createCity(960 + i, i < 5 ? 0 : 1, { q: hq.position.q + 2 + i, r: hq.position.r + 4 }, false); faith.cityFaith[960 + i] = 0; }
  const fallen = next.players[2];
  fallen.eliminated = true;
  next.cities[fallen.headquartersCityId].ownerId = 0;
  if (capitalFollows) faith.cityFaith[fallen.headquartersCityId] = 0;
  else delete faith.cityFaith[fallen.headquartersCityId];
  return next;
}

test('v26: an eliminated non-follower still blocks the faith victory until its former capital follows; v25 lets it through', () => {
  const v25 = table(25, false), v26 = table(26, false), v26Follows = table(26, true);
  resolveFaithRound(v25, contentFor(v25.setup));
  resolveFaithRound(v26, contentFor(v26.setup));
  resolveFaithRound(v26Follows, contentFor(v26Follows.setup));
  expect(v25.outcome).toMatchObject({ kind: 'faith', winners: [0] });
  expect(v26.outcome).toBeNull();
  expect(v26Follows.outcome).toMatchObject({ kind: 'faith', winners: [0] });
});
