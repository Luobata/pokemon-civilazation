import { LATEST_GAMEPLAY_VERSION } from '../content/eras.ts';
import { SECTIONS } from './sections.ts';

const main = document.querySelector<HTMLElement>('#guide-main')!;
const nav = document.querySelector<HTMLElement>('#guide-nav')!;
const search = document.querySelector<HTMLInputElement>('#guide-search')!;

document.querySelector('#guide-version')!.textContent = `对应游戏版本：玩法 v${LATEST_GAMEPLAY_VERSION}（新局默认）`;
main.innerHTML = `<header class="guide-hero"><h1>训练家手册</h1>
  <p>宝可梦 × 文明的完整玩法说明与攻略。数值表直接读取游戏数据，规则描述针对新开对局（玩法 v${LATEST_GAMEPLAY_VERSION}）。读取旧版本存档时，部分系统可能不存在。</p></header>
  ${SECTIONS.map(section => `<section class="guide-section" id="${section.id}" data-group="${section.group}"><h2>${section.title}${section.badge ? `<small>${section.badge}</small>` : ''}</h2>${section.html}</section>`).join('')}
  <p class="no-results">没有找到匹配的章节。</p>`;

let group = '';
nav.innerHTML = SECTIONS.map(section => {
  const heading = section.group !== group ? `<span class="nav-group">${section.group}</span>` : '';
  group = section.group;
  return `${heading}<a href="#${section.id}" data-nav="${section.id}">${section.title}</a>`;
}).join('');

search.addEventListener('input', () => {
  const query = search.value.trim().toLowerCase();
  main.classList.toggle('searching', query.length > 0);
  let shown = 0;
  for (const element of main.querySelectorAll<HTMLElement>('.guide-section')) {
    const match = !query || element.textContent!.toLowerCase().includes(query);
    element.hidden = !match;
    nav.querySelector<HTMLElement>(`[data-nav="${element.id}"]`)!.hidden = !match;
    if (match) shown++;
  }
  main.querySelector('.no-results')!.classList.toggle('show', shown === 0);
});

const observer = new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) {
    for (const link of nav.querySelectorAll('a')) link.classList.toggle('active', link.dataset.nav === entry.target.id);
  }
}, { rootMargin: '0px 0px -70% 0px' });
for (const section of main.querySelectorAll('.guide-section')) observer.observe(section);

if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
document.querySelector<HTMLElement>('#startup-notice')!.hidden = true;
