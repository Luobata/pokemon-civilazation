import type { AiPersonality, GameSetup } from '../src/core/model.ts';

export const PERSONALITIES: AiPersonality[] = ['expansion', 'aggressive', 'conservative'];
export type Match = { id: string; seed: number; mode: '1v1' | '1v3' | 'smoke'; leg: number; personalities: AiPersonality[]; width?: number; height?: number };
export function explorationMatches(count: number): Match[] {
  const pairs: [AiPersonality, AiPersonality][] = [['expansion', 'aggressive'], ['expansion', 'conservative'], ['aggressive', 'conservative']];
  const base = Math.floor(count / 3);
  return Array.from({ length: count }, (_, index) => {
    const seed = index + 1, pair = pairs[index < base ? 0 : index < base * 2 ? 1 : 2];
    const four = [...PERSONALITIES, PERSONALITIES[index % 3]];
    const rotated = four.slice(index % 4).concat(four.slice(0, index % 4));
    return [
      { id: `1v1-${seed}-0`, seed, mode: '1v1' as const, leg: 0, personalities: [...pair] },
      { id: `1v1-${seed}-1`, seed, mode: '1v1' as const, leg: 1, personalities: [...pair].reverse() },
      { id: `1v3-${seed}-0`, seed, mode: '1v3' as const, leg: 0, personalities: rotated },
    ];
  }).flat();
}
export function matchSetup(match: Match, roundLimit: 100 | 200 | 300 = 100): GameSetup {
  return { seed: match.seed, width: match.width ?? 24, height: match.height ?? 16, roundLimit,
    players: match.personalities.map((personality, id) => ({ id, controller: 'ai', personality })) };
}
