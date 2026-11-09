import { RULE_QUERIES } from '../../../src/ai/query.ts';
import { planNext } from '../../../src/ai/plan.ts';
import { rememberCityRejection } from '../../../src/ai/memory.ts';
import type { RejectedCitySite } from '../../../src/ai/memory.ts';
import { GameSession } from '../../../src/app/session.ts';
import { contentFor } from '../../../src/content/units.ts';
import { hexDistance } from '../../../src/core/hex.ts';
import type { Hex } from '../../../src/core/hex.ts';
import { previewAttack } from '../../../src/core/preview.ts';
import type { AttackPreview } from '../../../src/core/preview.ts';
import type { CombatTarget, GameSetup } from '../../../src/core/model.ts';

// Real v22 games on the wrapping 24×16 map: the AI plays every seat (player 0 included) through the normal
// GameSession, so each save replays exactly; nothing is patched. A search stops at player 0's turn the first
// time an attack situation is available, or keeps the save from just before an end turn whose AI turns
// present battles (or a city capture) to player 0.
const setupFor = (seed: number): GameSetup => ({ seed, width: 24, height: 16, roundLimit: 100, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion: 22,
  players: [{ id: 0, controller: 'human', starterId: 'charmander', leaderId: 'oak' },
    { id: 1, controller: 'ai', personality: 'aggressive', leaderId: 'lance' }, { id: 2, controller: 'ai', personality: 'aggressive', leaderId: 'giovanni' }] });

/** counter: adjacent hit on a Pokémon that survives and strikes back. ranged: a hit from two or more tiles. knockdown: a sure knockdown of another civilization's Pokémon. */
export type AttackScenario = 'counter' | 'ranged' | 'knockdown';
export type AttackFixture = { save: string; seed: number; round: number; unitId: number; target: CombatTarget; attacker: Hex; targetPosition: Hex; preview: Extract<AttackPreview, { ok: true }> };
/** `battles`: positions of the AI battles (attacker not player 0) the end turn presents to player 0. */
export type AiBattleFixture = { save: string; seed: number; round: number; battles: Hex[][] };
/** An end turn after which player 0 sees an AI capture a city (`previousOwner` before the capture). */
export type AiCaptureFixture = { save: string; seed: number; round: number; cityId: number; city: Hex; attacker: Hex; previousOwner: number | null; ownerId: number | null };
type Found = Partial<Record<AttackScenario, AttackFixture>> & { ai?: AiBattleFixture; capture?: AiCaptureFixture };
/** Seeds known to reach each situation early (searched first; the search falls back to seeds 1–12). */
const PREFERRED: Record<keyof Found, number> = { counter: 1, ranged: 1, ai: 1, knockdown: 8, capture: 8 };

function classify(preview: Extract<AttackPreview, { ok: true }>, distance: number, civilizationTarget: boolean): AttackScenario | null {
  if (preview.knockdown === 'guaranteed') return civilizationTarget ? 'knockdown' : null;
  if (preview.knockdown !== 'none') return null;
  if (distance === 1 && preview.counter.trigger === 'always' && preview.counter.damage > 0) return 'counter';
  if (distance > 1) return 'ranged';
  return null;
}

/** Plays seed `seed` until `need` is found (recording any other situation met on the way) or the game ends. */
function search(seed: number, found: Found, need: keyof Found) {
  const setup = setupFor(seed), content = contentFor(setup);
  const driver = new GameSession(setup);
  const memory: RejectedCitySite[] = [];
  while (!found[need]) {
    const state = driver.getState();
    if (state.outcome || state.round > 90 || state.activePlayerId !== 0) return;
    const view = driver.getView();
    for (const unit of view.units) if (unit.ownerId === 0 && unit.kind === 'pokemon' && unit.actionLeft) {
      for (const other of view.units) if (other.ownerId !== 0) {
        const target = { kind: 'unit' as const, id: other.id };
        const preview = previewAttack(view, unit.id, target, content);
        if (!preview.ok) continue;
        const scenario = classify(preview, hexDistance(unit.position, other.position, view.map), other.ownerId !== null && other.kind === 'pokemon');
        if (scenario && !found[scenario]) found[scenario] = { save: driver.save(), seed, round: view.round, unitId: unit.id, target, attacker: unit.position, targetPosition: other.position, preview };
      }
    }
    const command = planNext(view, { ...RULE_QUERIES, content }, memory);
    const before = command.action.type === 'EndTurn' && (!found.ai || !found.capture) ? driver.save() : null;
    let result = driver.issue(command.action);
    if (!result.ok) {
      rememberCityRejection(memory, view, command, result.reason);
      result = driver.issue({ type: 'EndTurn' });
      if (!result.ok) throw new Error(`Combat presentation fixture rejected EndTurn: ${result.reason}`);
    }
    if (before) {
      const battles = driver.presentationQueue.flatMap(event => event.payload.type === 'BattleResolved' && state.units[event.payload.attackerId]?.ownerId !== 0 ? [event.payload] : []);
      if (battles.length && !found.ai) found.ai = { save: before, seed, round: view.round, battles: battles.map(battle => battle.positions) };
      const capture = battles.find(battle => battle.capturedCity && battle.target.kind === 'city');
      if (capture && !found.capture) {
        const cityId = capture.target.id;
        found.capture = { save: before, seed, round: view.round, cityId, city: capture.positions[1], attacker: capture.positions[0],
          previousOwner: state.cities[cityId].ownerId, ownerId: driver.getState().cities[cityId]?.ownerId ?? null };
      }
    }
    driver.skipAnimations();
  }
}

const found: Found = {};
function find<K extends keyof Found>(need: K): NonNullable<Found[K]> {
  const seeds = [PREFERRED[need], ...Array.from({ length: 12 }, (_, index) => index + 1).filter(seed => seed !== PREFERRED[need])];
  for (const seed of seeds) { if (found[need]) break; search(seed, found, need); }
  const fixture = found[need];
  if (!fixture) throw new Error(`No v22 game reached the ${need} situation for player 0`);
  return fixture as NonNullable<Found[K]>;
}
export const attackFixture = (scenario: AttackScenario): AttackFixture => find(scenario);
export const aiBattleFixture = (): AiBattleFixture => find('ai');
export const aiCaptureFixture = (): AiCaptureFixture => find('capture');
