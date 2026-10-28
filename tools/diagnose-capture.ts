/**
 * M5-2 one-off capture diagnosis, retained for rerunning historical unpatched runs.
 * Usage: node tools/diagnose-capture.ts <source> <output>
 * Input: source/games.jsonl rows with id, plus games/<id>.json MatchResult records
 * (setup, personalities, accepted commands). Replays with current default content/AI;
 * not suitable for patched runs or incompatible rules versions. Writes capture evidence
 * into output; use a fresh output directory to preserve earlier evidence.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGame } from '../src/core/game.ts';
import { step } from '../src/core/step.ts';
import { observe } from '../src/core/vision.ts';
import { previewCapture } from '../src/core/preview.ts';
import { canCaptureByPersonality } from '../src/ai/plan.ts';
import { CONTENT } from '../src/content/units.ts';
import type { MatchResult } from './simulate.ts';

type CaptureExample = { round: number; seq: number; unitId: number; targetId: number; hp: number; maxHp: number; probability: number; selected: object };
type CaptureSeat = { game: string; seed: number; playerId: number; personality: string; researched: boolean; boughtBalls: number;
  everHadBall: boolean; sawEligibleWild: boolean; hadLegalCapture: boolean; legalDecisions: number; lowHpLegalDecisions: number;
  selected: Record<string, number>; firstLegal: CaptureExample | null; firstLowHpAttack: CaptureExample | null };

export function diagnoseCapture(source: string, output: string) {
  mkdirSync(output, { recursive: true });
  const games = readFileSync(resolve(source, 'games.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as { id: string });
  const seats: CaptureSeat[] = [];
  for (const [index, { id }] of games.entries()) {
    const game = JSON.parse(readFileSync(resolve(source, 'games', `${id}.json`), 'utf8')) as MatchResult;
    let state = createGame(game.setup);
    const activity = game.personalities.map((personality, playerId) => ({ game: id, seed: game.seed, playerId, personality,
      researched: false, boughtBalls: 0, everHadBall: false, sawEligibleWild: false, hadLegalCapture: false,
      legalDecisions: 0, lowHpLegalDecisions: 0, selected: {} as Record<string, number>,
      firstLegal: null as null | { round: number; seq: number; unitId: number; targetId: number; hp: number; maxHp: number; probability: number; selected: object },
      firstLowHpAttack: null as null | { round: number; seq: number; unitId: number; targetId: number; hp: number; maxHp: number; probability: number; selected: object },
    }));
    for (const command of game.commands) {
      const seat = activity[command.actorId], view = observe(state, command.actorId), player = view.economy.player;
      seat.researched ||= player.research.unlockedIds.includes('domestication');
      seat.everHadBall ||= player.ballInventory.pokeBall + player.ballInventory.greatBall > 0;
      if (command.action.type === 'BuyBall') seat.boughtBalls += command.action.quantity;
      const wild = view.units.filter(target => canCaptureByPersonality(view, target));
      seat.sawEligibleWild ||= wild.length > 0;
      const legal = [];
      for (const unit of view.units.filter(unit => unit.ownerId === command.actorId && unit.kind === 'pokemon' && unit.actionLeft)) {
        for (const target of wild) for (const ball of ['pokeBall', 'greatBall'] as const) {
          const capture = previewCapture(view, unit.id, target.id, ball);
          if (capture.ok && target.kind === 'pokemon') legal.push({ round: state.round, seq: state.commandSeq, unitId: unit.id,
            targetId: target.id, hp: target.hp, maxHp: CONTENT.species[target.speciesId].maxHp, probability: capture.probability, selected: command.action });
        }
      }
      if (legal.length) {
        seat.hadLegalCapture = true; seat.legalDecisions++; seat.firstLegal ??= legal[0];
        seat.selected[command.action.type] = (seat.selected[command.action.type] ?? 0) + 1;
        if (legal.some(row => row.hp * 2 < row.maxHp)) seat.lowHpLegalDecisions++;
        const action = command.action;
        if (action.type === 'Attack' && action.target.kind === 'unit') seat.firstLowHpAttack ??= legal.find(row =>
          row.unitId === action.unitId && row.targetId === action.target.id && row.hp * 2 < row.maxHp) ?? null;
      }
      const next = step(state, command); if (!next.ok) throw new Error(`${id}/${state.commandSeq}: ${next.reason}`); state = next.state;
    }
    seats.push(...activity);
    if (index % 30 === 29) console.log(JSON.stringify({ completed: index + 1, total: games.length }));
  }
  const summary = ['expansion', 'aggressive', 'conservative'].map(personality => {
    const group = seats.filter(seat => seat.personality === personality);
    const count = (key: 'researched' | 'everHadBall' | 'sawEligibleWild' | 'hadLegalCapture') => group.filter(seat => seat[key]).length;
    return { personality, seats: group.length, researched: count('researched'), everHadBall: count('everHadBall'),
      sawEligibleWild: count('sawEligibleWild'), hadLegalCapture: count('hadLegalCapture'), boughtBalls: group.reduce((sum, seat) => sum + seat.boughtBalls, 0),
      legalDecisions: group.reduce((sum, seat) => sum + seat.legalDecisions, 0), lowHpLegalDecisions: group.reduce((sum, seat) => sum + seat.lowHpLegalDecisions, 0),
      selected: group.reduce((sum, seat) => { for (const [action, count] of Object.entries(seat.selected)) sum[action] = (sum[action] ?? 0) + count; return sum; }, {} as Record<string, number>),
      example: group.find(seat => seat.firstLowHpAttack) ?? group.find(seat => seat.firstLegal) };
  });
  writeFileSync(resolve(output, 'capture-diagnosis.json'), JSON.stringify({ source: resolve(source), summary, seats }, null, 2));
  return summary;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [source, output] = process.argv.slice(2);
  if (!source || !output) throw new Error('Usage: node tools/diagnose-capture.ts <recorded-run> <new-output-directory>');
  console.log(JSON.stringify(diagnoseCapture(source, output)));
}
