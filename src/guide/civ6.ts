// "给《文明》玩家": the handbook side of src/content/civ-glossary.ts (the in-game hints read the same data).
import { CIV_GLOSSARY, CIV_GLOSSARY_GROUPS, CIV_GLOSSARY_IDS } from '../content/civ-glossary.ts';
import type { CivGlossaryEntry, CivGlossaryId } from '../content/civ-glossary.ts';
import type { GuideSection } from './sections.ts';
import { table } from './tables.ts';

export const CIV6_SECTION_ID = 'civ6';

/** Civ VI names for a row of the systems overview, e.g. "文明 6：市政 / 政策卡". */
export const civ6Terms = (...ids: CivGlossaryId[]): string =>
  `<small class="civ-term" data-civ-terms="${ids.join(' ')}">文明 6：${ids.map(id => CIV_GLOSSARY[id].civ).join(' / ')}</small>`;

/** The glossary chapter; `sections` supplies the titles for the 详见 links. */
export function civ6Section(sections: readonly GuideSection[]): GuideSection {
  const title = (id: string) => sections.find(section => section.id === id)?.title ?? id;
  const rows = CIV_GLOSSARY_GROUPS.flatMap(group => CIV_GLOSSARY_IDS.filter(id => CIV_GLOSSARY[id].group === group).map(id => {
    const entry: CivGlossaryEntry = CIV_GLOSSARY[id];
    return [group, `<strong>${entry.term}</strong>${entry.aliases?.length ? `<br><small>也写作${entry.aliases.join('、')}</small>` : ''}`,
      entry.civ, entry.note ?? '基本相同', `<a href="#${entry.section}">${title(entry.section)}</a>`];
  }));
  return { id: CIV6_SECTION_ID, group: '入门', title: '给《文明》玩家', badge: `${CIV_GLOSSARY_IDS.length} 个术语`, html: `
    <p>本作的系统大多能在《文明 6》里找到对应，只是换成了宝可梦的名字。下表按“本作叫什么 → 《文明 6》里叫什么 → 有什么不同”列出；游戏里这些系统的标题旁边也有灰色的「文明 6：…」小标签，鼠标停上去会显示同样的说明。</p>
    ${table(['类别', '本作', '《文明 6》', '差别', '详见'], rows, [], 'civ6-glossary')}
    <p class="note">没有列出的系统在《文明 6》里没有接近的对应，不要直接套用：冠军赛、圣所与起源胜利、图鉴胜利、属性精华与道馆、时代能力（天气、Mega 等）、开局目标。</p>` };
}
