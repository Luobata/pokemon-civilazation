import { contentForView } from '../content/units.ts';
import type { Command, PlayerView } from '../core/model.ts';
import { renderTechTree } from './tech-tree-panel.ts';
import { researchQueue } from './client-plans.ts';
import '../ui-icons.css';

let rendered = '';
export function resetResearchPanel(): void {
  rendered = '';
  document.querySelector<HTMLElement>('#research-panel')!.innerHTML = '';
}

/**
 * Civilization-style research screen: a horizontally scrolling branching tech tree.
 * The compact select above the tree stays as the keyboard path (R / T focuses it).
 */
export function renderResearchPanel(view: PlayerView, issue: (action: Command['action']) => void, disabled: boolean): void {
  const content = contentForView(view);
  const research = view.economy.player.research;
  const found = view.expansion?.discoveries;
  const perRound = view.economy.cities.reduce((sum, city) => sum + city.yields.research, 0);
  researchQueue.prune(view);
  const signature = JSON.stringify([research, disabled, found, perRound, researchQueue.list()]);
  if (signature === rendered) return;
  rendered = signature;
  const root = document.querySelector<HTMLElement>('#research-panel')!;
  renderTechTree(root, view, content, issue, disabled);
}
