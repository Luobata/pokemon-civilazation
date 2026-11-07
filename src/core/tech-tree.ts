// Gameplay v22 tech tree rules shared by authority, views, AI and UI (data in src/content/tech-tree.ts).
// A player researches on the tree when `research.tree` is set (only new v22 games set it), so every helper here is a
// no-op for older saves and replays.
import type { TechId } from '../content/economy.ts';
import type { PolicyEffects } from '../content/policies.ts';
import { TREE_EFFECTS, TREE_GATES } from '../content/tech-tree.ts';
import type { Content } from '../content/units.ts';

export type TreeResearcher = { research: { unlockedIds: readonly string[]; tree?: true } };
export const onTechTree = (player: TreeResearcher | undefined): boolean => player?.research.tree === true;

/** Prerequisites of `techId` the player has not completed yet (v22 content only; empty otherwise). */
export function missingPrerequisites(player: TreeResearcher, techId: TechId, content: Content): TechId[] {
  return (content.techs[techId]?.requires ?? []).filter(id => !player.research.unlockedIds.includes(id));
}
/** A v22 rule gate: open for older games, otherwise open once the gating technology is known. */
export function treeGateOpen(player: TreeResearcher | undefined, gate: keyof typeof TREE_GATES): boolean {
  return !onTechTree(player) || player!.research.unlockedIds.includes(TREE_GATES[gate]);
}
/** Standing bonuses from completed v22 technologies (empty for older games). */
export function treeEffects(player: TreeResearcher | undefined): PolicyEffects {
  if (!onTechTree(player)) return {};
  const total: Required<PolicyEffects> = { trainedXp: 0, trainingDiscountPercent: 0, cityProduction: 0, cityFood: 0, cityGold: 0, cityResearch: 0,
    workPointBonus: 0, captureBonus: 0, healing: 0, ballDiscount: 0, upkeepReduction: 0, visionBonus: 0 };
  for (const id of player!.research.unlockedIds) {
    for (const [key, value] of Object.entries(TREE_EFFECTS[id as TechId] ?? {}) as [keyof PolicyEffects, number][]) total[key] += value;
  }
  return Object.fromEntries(Object.entries(total).filter(([, value]) => value !== 0));
}
