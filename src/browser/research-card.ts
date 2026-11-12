// Gameplay v24 D (docs/design/world-v24.md §5.3): the Pokédex research card of one species (unit panel) and the card book
// summary (Pokédex card). Collapsed by default; reads only the viewer's own book from the PlayerView.
import { RESEARCH_TASK_IDS, RESEARCH_TASK_NAMES, RESEARCH_TASK_RULES_V24, researchSpecialFor, researchSpecialLabel } from '../content/research-tasks.ts';
import type { ResearchTaskId } from '../content/research-tasks.ts';
import type { SpeciesId } from '../content/species.ts';
import type { Content } from '../content/units.ts';
import type { PlayerView } from '../core/model.ts';
import { habitatBiomes, hasTask, tasksDone } from '../core/research-tasks.ts';
import type { ResearchCard, ResearchTaskEvent } from '../core/research-tasks.ts';
import '../research-tasks.css';

const R = RESEARCH_TASK_RULES_V24;
const BIOME_LABEL: Record<string, string> = { grassland: '草原', forest: '森林', mountain: '山地', ocean: '海洋', desert: '荒漠', snow: '雪原', volcano: '火山' };
const escape = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const usesResearchTasks = (view: Pick<PlayerView, 'expansion'>) => Boolean(view.expansion?.researchTasks);

/** Label of one task on this species' card (task 2 with its count, task 5 with its condition). */
function taskLabel(task: ResearchTaskId, card: ResearchCard | undefined, speciesId: SpeciesId, content: Content): string {
  if (task === 'knockouts') return `击倒 ${Math.min(card?.knockouts ?? 0, R.knockoutsNeeded)}/${R.knockoutsNeeded} 只`;
  if (task !== 'special') return RESEARCH_TASK_NAMES[task];
  const typeId = content.species[speciesId].typeId, label = researchSpecialLabel(typeId);
  if (researchSpecialFor(typeId).kind !== 'habitat') return label;
  const biomes = habitatBiomes(content, speciesId).map(biome => BIOME_LABEL[biome] ?? biome);
  return `${label}（${biomes.length ? biomes.join('、') : '野外不出现'}）`;
}
/** What the next reward is and how far away ("再击倒 1 只得调查笔记"). */
export function researchNextHint(card: ResearchCard | undefined): string {
  const done = tasksDone(card?.tasks ?? 0);
  if (done >= R.completeAt) return '调查完成。';
  const goal = done < R.notesAt ? { at: R.notesAt, text: `调查笔记（科研 +${R.notesResearch}）` }
    : done < R.captureAt ? { at: R.captureAt, text: `捕捉率 +${R.captureBonus}` }
      : { at: R.completeAt, text: `调查完成（金币 +${R.completeGold}、世代分 +${R.completeEraScore}）` };
  const missing = goal.at - done;
  // One task short and that task is the second knockout: say so.
  if (missing === 1 && !hasTask(card, 'knockouts') && (card?.knockouts ?? 0) === R.knockoutsNeeded - 1) return `再击倒 1 只得${goal.text}。`;
  return `再完成 ${missing} 项得${goal.text}。`;
}
const pips = (card: ResearchCard | undefined) => RESEARCH_TASK_IDS.map(task => `<i class="${hasTask(card, task) ? 'done' : ''}"></i>`).join('');

/** One species' card, collapsed unless `open`. Empty when the game has no research tasks. */
export function researchCardMarkup(view: PlayerView, speciesId: SpeciesId, content: Content, open = false): string {
  const book = view.expansion?.researchTasks;
  if (!book) return '';
  const card = book[speciesId], done = tasksDone(card?.tasks ?? 0);
  const rows = RESEARCH_TASK_IDS.map(task => `<li class="${hasTask(card, task) ? 'done' : ''}" data-task="${task}">${hasTask(card, task) ? '✔' : '○'} ${escape(taskLabel(task, card, speciesId, content))}</li>`).join('');
  return `<details class="research-card" id="research-card" data-species="${speciesId}"${open ? ' open' : ''}><summary><span>图鉴调查 · ${escape(content.species[speciesId].name)}</span><span class="research-pips" aria-label="完成 ${done}/5">${pips(card)}</span><b>${done}/5</b></summary>
    <ol class="research-tasks">${rows}</ol><p class="research-next">${researchNextHint(card)}${done >= R.captureAt ? ` 已获得：捕捉率 +${R.captureBonus}。` : ''}</p>
    <p class="research-note">奖励：2 项科研 +${R.notesResearch}，4 项对这个物种的捕捉率 +${R.captureBonus}，5 项金币 +${R.completeGold}、世代分 +${R.completeEraScore}（每世代最多 ${R.eraScoreCapPerEra} 次）。调查卡不计入图鉴胜利；进度只有你自己知道。</p></details>`;
}

/** The book in the Pokédex card: counts plus a collapsible list of every species with progress. */
export function researchBookMarkup(view: PlayerView, content: Content): string {
  const book = view.expansion?.researchTasks;
  if (!book) return '';
  const entries = (Object.entries(book) as [SpeciesId, ResearchCard][]).filter(([, card]) => card.tasks || card.knockouts)
    .sort((a, b) => tasksDone(b[1].tasks) - tasksDone(a[1].tasks) || content.species[a[0]].name.localeCompare(content.species[b[0]].name, 'zh'));
  const complete = entries.filter(([, card]) => tasksDone(card.tasks) >= R.completeAt).length, bonus = entries.filter(([, card]) => tasksDone(card.tasks) >= R.captureAt).length;
  const list = entries.map(([speciesId, card]) => `<li data-species="${speciesId}" title="${escape(RESEARCH_TASK_IDS.map(task => `${hasTask(card, task) ? '✔' : '○'}${taskLabel(task, card, speciesId, content)}`).join(' · '))} — ${escape(researchNextHint(card))}"><span>${escape(content.species[speciesId].name)}</span><span class="research-pips">${pips(card)}</span></li>`).join('');
  return `<details class="research-book" id="research-book" data-system="research-book"><summary>图鉴调查卡 · ${entries.length} 种有进度 · 完成 ${complete} · 捕捉率加成 ${bonus}</summary>
    <p class="research-note">每个物种 5 项：看到、击倒 ${R.knockoutsNeeded} 只、收服、看到进化、特别条件（恶/幽灵夜里击倒；水/火/岩石/地面/钢在对应天气里击倒；其他在栖息地收服）。不计入图鉴胜利。</p>
    <ul class="research-list">${list || '<li>还没有调查进度。</li>'}</ul></details>`;
}

/** Notification text for one completed task (src/browser/notifications.ts shows it as a single, replaceable rail item). */
export function researchTaskToast(event: ResearchTaskEvent, view: PlayerView, content: Content): { title: string; detail: string } {
  const name = content.species[event.speciesId].name, reward = event.reward;
  const task = event.task === 'special' ? researchSpecialLabel(content.species[event.speciesId].typeId) : RESEARCH_TASK_NAMES[event.task];
  const parts = reward ? [reward.research ? `调查笔记：科研 +${reward.research}` : '', reward.captureBonus ? `对${name}的捕捉率 +${reward.captureBonus}` : '',
    reward.gold ? `调查完成：金币 +${reward.gold}` : '', reward.eraScore ? `世代分 +${reward.eraScore}` : ''].filter(Boolean) : [];
  return { title: `图鉴调查：${name} · ${task}（${event.tasksDone}/5）`, detail: parts.length ? `${parts.join('，')}。` : researchNextHint(view.expansion?.researchTasks?.[event.speciesId]) };
}
