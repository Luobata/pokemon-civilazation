/** Rebuild BL-11 fixtures using accepted commands only; never edit authoritative state. */
import { writeFileSync } from 'node:fs';
import { createGame } from '../../src/core/game.ts';
import { step } from '../../src/core/step.ts';
import { observe, projectEvents } from '../../src/core/vision.ts';
import { isMapUnit } from '../../src/core/model.ts';
import type { AiPersonality, Command, GameSetup, GameState } from '../../src/core/model.ts';
import { replay } from '../../src/app/session.ts';
import { canonicalSerialize, stateDigest } from '../../src/core/snapshot.ts';
import { CONTENT } from '../../src/content/units.ts';
import { planNext } from '../../src/ai/plan.ts';
import { RULE_QUERIES } from '../../src/ai/query.ts';
import { rememberCityRejection } from '../../src/ai/memory.ts';
import type { RejectedCitySite } from '../../src/ai/memory.ts';
import type { RecordedFixture } from '../../tests/browser/fixtures/reachable.ts';
import { generateRealGame, realGameLog } from '../../tests/browser/fixtures/real-game.ts';

const fixtures: Record<string, RecordedFixture> = {};
function record(name: string, state: GameState, commands: Command[], extra: Partial<RecordedFixture> = {}) {
  if (fixtures[name]) return;
  fixtures[name] = { log: { version: 1, schemaVersion: state.schemaVersion, rulesVersion: state.rulesVersion,
    contentVersion: state.contentVersion, setup: state.setup, commands: [...commands] }, digest: stateDigest(state), round: state.round, ...extra };
  if (canonicalSerialize(replay(fixtures[name].log)) !== canonicalSerialize(state)) throw new Error(`Replay mismatch: ${name}`);
  console.log(name, 'seed', state.setup.seed, 'round', state.round, 'commands', commands.length, fixtures[name].digest);
}
function setup(seed: number, personalities: AiPersonality[]): GameSetup {
  return { seed, width: 24, height: 16, roundLimit: 100, players: [
    { id: 0, controller: 'human', starterId: 'bulbasaur' },
    ...personalities.slice(1).map((personality, index) => ({ id: index + 1, controller: 'ai' as const, personality })),
  ] };
}
function scriptedDiplomacy() {
  let state = createGame(setup(1, ['conservative', 'conservative']));
  const commands: Command[] = [];
  const issue = (action: Command['action']) => {
    const command = { actorId: state.activePlayerId, expectedSeq: state.commandSeq, action };
    const result = step(state, command);
    if (!result.ok) throw new Error(result.reason);
    commands.push(command); state = result.state;
  };
  record('diplomacy', state, commands);
  issue({ type: 'DeclareWar', targetPlayerId: 1 });
  while (state.round < 6 || state.activePlayerId !== 1) issue({ type: 'EndTurn' });
  issue({ type: 'MakePeace', targetPlayerId: 0 });
  issue({ type: 'EndTurn' });
  record('incoming-peace', state, commands);
  state = createGame(setup(1, ['conservative', 'conservative'])); commands.length = 0;
  while (!state.outcome) issue({ type: 'EndTurn' });
  if (state.outcome.winners.length !== 2) throw new Error('Expected a naturally tied score');
  record('score', state, commands);
}
function retryCapture(state: GameState, prefix: Command[], action: Extract<Command['action'], { type: 'Capture' }>) {
  const commands = [...prefix];
  for (let attempt = 0; attempt < 12 && !state.outcome; attempt++) {
    const command: Command = { actorId: 0, expectedSeq: state.commandSeq, action };
    const result = step(state, command);
    if (!result.ok) return;
    if (result.events.some(event => event.payload.type === 'Captured' && event.payload.success)) {
      record('capture-success', state, commands, { action }); return;
    }
    commands.push(command); state = result.state;
    do {
      const end: Command = { actorId: state.activePlayerId, expectedSeq: state.commandSeq, action: { type: 'EndTurn' } };
      const next = step(state, end);
      if (!next.ok) return;
      commands.push(end); state = next.state;
    } while (state.activePlayerId !== 0 && !state.outcome);
    if (!state.players[0].ballInventory[action.ballId]) {
      const buy: Command = { actorId: 0, expectedSeq: state.commandSeq, action: { type: 'BuyBall',
        cityId: state.players[0].headquartersCityId, ballId: action.ballId, quantity: 1 } };
      const next = step(state, buy);
      if (!next.ok) return;
      commands.push(buy); state = next.state;
    }
  }
}
function mine(seed: number, personalities: AiPersonality[]) {
  let state = createGame(setup(seed, personalities));
  const commands: Command[] = [], memory: RejectedCitySite[] = [];
  let humanEnd: { state: GameState; commands: Command[] } | undefined;
  while (!state.outcome && commands.length < 10_000) {
    const view = observe(state, state.activePlayerId);
    // Script the human with the requested policy; the actual state is only changed by step.
    view.economy.player.personality = personalities[state.activePlayerId];
    let command = planNext(view, RULE_QUERIES, memory);
    let result = step(state, command);
    if (!result.ok) {
      rememberCityRejection(memory, view, command, result.reason);
      command = { actorId: state.activePlayerId, expectedSeq: state.commandSeq, action: { type: 'EndTurn' } };
      result = step(state, command);
    }
    if (!result.ok) throw new Error(result.reason);
    const action = command.action;
    if (state.activePlayerId === 0) {
      if (action.type === 'EndTurn') humanEnd = { state, commands: [...commands] };
      if (action.type === 'Attack' && action.target.kind === 'unit') {
        const target = state.units[action.target.id], after = result.state.units[action.target.id];
        if (target.ownerId === null && after && after.hp < target.hp && isMapUnit(result.state.units[action.unitId])) record('attack', state, commands, { action });
      }
      if (action.type === 'Capture') {
        const target = state.units[action.targetUnitId];
        const captured = result.events.find(event => event.payload.type === 'Captured');
        if (target.kind === 'pokemon' && target.hp * 2 < CONTENT.species[target.speciesId].maxHp && captured?.payload.type === 'Captured') {
          record(captured.payload.success ? 'capture-success' : 'capture-failure', state, commands, { action });
          if (!fixtures['capture-success']) retryCapture(state, commands, action);
        }
      }
      if (action.type === 'Evolve') record('evolve', state, commands, { action });
      const recovering = Object.values(state.units).find(unit => unit.ownerId === 0 && unit.location === 'recovering');
      const selectable = Object.values(state.units).find(unit => unit.ownerId === 0 && unit.kind === 'pokemon' && isMapUnit(unit) && unit.actionLeft);
      if (recovering?.location === 'recovering' && selectable) record('recovering', state, commands, { unitId: selectable.id, cityId: recovering.cityId });
      const neutral = view.cities.find(city => city.ownerId === null);
      if (neutral) record('neutral', state, commands, { cityId: neutral.id });
    } else if (state.activePlayerId === 1 && action.type === 'Move' && humanEnd
      && projectEvents(state, result.state, result.events, 0).some(event => event.payload.type === 'Moved')) {
      record('visible-ai', humanEnd.state, humanEnd.commands);
    }
    commands.push(command); state = result.state;
  }
  if (state.outcome && personalities.length === 2) record(state.outcome.kind, state, commands);
}
scriptedDiplomacy();
const mined = ['attack', 'capture-success', 'capture-failure', 'evolve', 'recovering', 'neutral', 'visible-ai', 'conquest', 'playerDefeat'];
// Fixed source games found during BL-11 exploration; no seed search during tests.
mine(1, ['conservative', 'expansion', 'expansion', 'expansion']);
mine(1, ['aggressive', 'expansion', 'aggressive', 'conservative']);
mine(4, ['aggressive', 'aggressive']);
mine(5, ['aggressive', 'aggressive']);
mine(14, ['conservative', 'expansion', 'expansion', 'expansion']);
const missing = mined.filter(name => !fixtures[name]);
if (missing.length) throw new Error(`Missing fixtures: ${missing.join(', ')}`);
const dense = generateRealGame({ seed: 8, width: 40, height: 26, roundLimit: 300, personalities: ['expansion', 'expansion', 'expansion', 'expansion'] });
if (dense.maxUnits < 100) throw new Error('Expected at least 100 deployed units');
record('dense', dense.maxState, realGameLog(dense, dense.maxCommands).commands);
// One command per line keeps generated traces inspectable without snapshot-sized diffs.
const json = '{\n' + Object.entries(fixtures).map(([name, fixture]) => {
  const body = JSON.stringify({ ...fixture, log: { ...fixture.log, commands: [] } }, null, 2)
    .replace('"commands": []', '"commands": [\n' + fixture.log.commands.map(command => '      ' + JSON.stringify(command)).join(',\n') + '\n    ]');
  return '  ' + JSON.stringify(name) + ': ' + body.replaceAll('\n', '\n  ');
}).join(',\n') + '\n}\n';
writeFileSync(new URL('../../tests/browser/fixtures/reachable.json', import.meta.url), json);
