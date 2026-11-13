// Gameplay v26 P1 UI (docs/design/depth-v26.md §2.3, §2.5): the lineup picker for relay battles — gym, guardian, Elite Four and conference.
// Pick who goes and in which order (click a Pokémon to add or remove it, ↑ ↓ or [ ] to move it, or drag the rows), read the matchup grid
// (each pair: your best multiplier on them, theirs on you, who strikes first) and the estimated win percent (16 fixed estimate seeds), or
// ask for the suggested lineup (the AI's own chooseLineup on the same view). PlayerView only; the command goes through the normal path.
// Kept in its own module so the presentation-only matchup grid and battle replay of another branch can be joined to it later.
import { GYM_LEADERS, STAGE_NAMES } from '../content/gym-circuit.ts';
import { CLASS_NAMES } from '../content/unit-classes.ts';
import { TYPE_NAMES } from '../content/type-names.ts';
import { CIVILIZATION_CONTENT } from '../content/civilization-systems.ts';
import { contentForView } from '../content/units.ts';
import type { Content } from '../content/units.ts';
import { chooseLineup } from '../ai/battle-plan.ts';
import { viewEliteFourBlocker, viewGymBlocker } from '../core/gym-circuit.ts';
import { hexDistance } from '../core/hex.ts';
import type { Command, PlayerView } from '../core/model.ts';
import { bestAttack } from '../core/team-battle.ts';
import type { RelayFighter } from '../core/team-battle.ts';
import { estimateLineup, lineupFighters, viewChampionshipSpec, viewEliteFourSpec, viewGuardianSpec, viewGymSpec } from '../core/team-battle-views.ts';
import type { LineupSpec } from '../core/team-battle-views.ts';
import { pokemonSpritePath } from './sprites.ts';
import { typeBadge, uiIcon } from './ui-icons.ts';
import { gymBlockerText, gymTitle } from './gym-panel.ts';
import '../lineup.css';

export type PickerKind = 'gym' | 'guardian' | 'elite' | 'championship';
/** `key`: the gym id or the sanctuary id (unused for the Elite Four and the conference). */
export type PickerTarget = { kind: PickerKind; key: string };
const esc = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function pickerSpec(view: PlayerView, target: PickerTarget, content: Content = contentForView(view)): LineupSpec | null {
  return target.kind === 'gym' ? viewGymSpec(view, Number(target.key), content) : target.kind === 'guardian' ? viewGuardianSpec(view, target.key, content)
    : target.kind === 'elite' ? viewEliteFourSpec(view, content) : viewChampionshipSpec(view, content);
}
export function pickerAction(target: PickerTarget, unitIds: number[]): Command['action'] {
  return target.kind === 'gym' ? { type: 'ChallengeGym', gymId: Number(target.key), unitIds } : target.kind === 'guardian' ? { type: 'ChallengeGuardian', siteId: target.key, unitIds }
    : target.kind === 'elite' ? { type: 'ChallengeEliteFour', unitIds } : { type: 'RegisterChampionshipTeam', unitIds };
}
/** Why this lineup cannot be sent now (null = the authority accepts it), from the view only. */
export function pickerBlocker(view: PlayerView, target: PickerTarget, unitIds: readonly number[], spec: LineupSpec): string | null {
  if (view.outcome || view.activePlayerId !== view.playerId) return '现在不是你的回合。';
  if (unitIds.length < spec.size.min || unitIds.length > spec.size.max) return spec.size.min === spec.size.max ? `要正好带 ${spec.size.min} 只宝可梦。` : `要带 ${spec.size.min}–${spec.size.max} 只宝可梦。`;
  if (target.kind === 'gym') { const reason = viewGymBlocker(view, Number(target.key), unitIds); return reason ? gymBlockerText(reason) : null; }
  if (target.kind === 'elite') { const reason = viewEliteFourBlocker(view, unitIds); return reason ? gymBlockerText(reason) : null; }
  if (target.kind === 'guardian') {
    const site = view.expansion?.civilization.sanctuaries.find(item => item.id === target.key);
    if (!site || site.ownerId !== view.playerId || site.guardianDefeated) return '先建立这座圣所。';
    if (!unitIds.every(id => spec.candidates.includes(id))) return '队伍里的宝可梦都要有行动，并在圣所 2 格内。';
    return unitIds.some(id => spec.onSite.includes(id)) ? null : '至少一只宝可梦要站在圣所上。';
  }
  return view.diplomacy.some(pair => pair.status === 'war' && (pair.a === view.playerId || pair.b === view.playerId)) ? '交战中不能报名联盟大会。' : null;
}
const title = (view: PlayerView, target: PickerTarget) => {
  if (target.kind === 'gym') { const gym = view.expansion?.gymCircuit?.gyms.find(item => item.id === Number(target.key)); return gym ? `道馆挑战 · ${gymTitle(gym)}` : '道馆挑战'; }
  if (target.kind === 'guardian') return `圣所守卫 · ${view.expansion?.civilization.sanctuaries.find(item => item.id === target.key)?.name ?? ''}`;
  return target.kind === 'elite' ? '四天王与冠军（连战 5 场，场间恢复一半损失的 HP）' : '联盟大会报名（6 只，按顺序出场）';
};
const multiplier = (value: number) => value === 0 ? '×0' : `×${(value / 100).toFixed(value % 100 === 0 ? 0 : value % 10 === 0 ? 1 : 2)}`;
const tone = (value: number) => value === 0 ? 'none' : value > 100 ? 'up' : value < 100 ? 'down' : 'even';
const stars = (count: number) => count ? `<span class="lp-stars" title="历练 +${count}（攻防）" aria-label="历练 ${count}">${'★'.repeat(count)}</span>` : '';
function fighterChip(fighter: RelayFighter, content: Content, extra = ''): string {
  const species = content.species[fighter.speciesId];
  return `<img src="${pokemonSpritePath(fighter.speciesId)}" alt="" width="32" height="32"><span class="lp-name"><b>${esc(species?.name ?? fighter.speciesId)}</b>`
    + `<small>${fighter.typeIds.map(type => typeBadge(type, 14)).join('')}${uiIcon(`class:${species?.role ?? 'melee'}`, { size: 14, label: `${CLASS_NAMES[species?.role ?? 'melee']}（先手 ${fighter.speed}）` })}`
    + ` HP ${fighter.hp}/${fighter.maxHp}${stars(fighter.veteran)}</small></span>${extra}`;
}
/** The matchup grid: your lineup (rows) × the opponent team (columns). */
export function matchupGridMarkup(lineup: readonly RelayFighter[], opponents: readonly RelayFighter[], content: Content): string {
  if (!lineup.length || !opponents.length) return '';
  const head = opponents.map(foe => `<th scope="col"><img src="${pokemonSpritePath(foe.speciesId)}" alt="${esc(content.species[foe.speciesId]?.name ?? foe.speciesId)}" width="28" height="28"></th>`).join('');
  const rows = lineup.map(me => `<tr><th scope="row"><img src="${pokemonSpritePath(me.speciesId)}" alt="${esc(content.species[me.speciesId]?.name ?? me.speciesId)}" width="28" height="28"></th>${opponents.map(foe => {
    const mine = bestAttack(me, foe), theirs = bestAttack(foe, me), first = me.speed !== foe.speed ? me.speed > foe.speed : me.attack + me.veteran >= foe.attack + foe.veteran;
    const label = `你用${TYPE_NAMES[mine.typeId]}打它 ${multiplier(mine.effectiveness)}，它用${TYPE_NAMES[theirs.typeId]}打你 ${multiplier(theirs.effectiveness)}，${first ? '你先手' : '它先手'}`;
    return `<td class="lp-cell" title="${esc(label)}" aria-label="${esc(label)}"><span class="lp-mine ${tone(mine.effectiveness)}">${multiplier(mine.effectiveness)}</span><span class="lp-theirs ${tone(theirs.effectiveness)}">${multiplier(theirs.effectiveness)}</span>${first ? '<span class="lp-first" aria-hidden="true">▲</span>' : ''}</td>`;
  }).join('')}</tr>`).join('');
  return `<table class="lp-grid" id="lineup-grid"><caption>克制格：左上 = 你打它，右下 = 它打你，▲ = 你先手</caption><thead><tr><th></th>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}
const bar = (percent: number) => `<span class="lp-bar" aria-hidden="true">${Array.from({ length: 16 }, (_, index) => `<i class="${index < Math.round(percent * 16 / 100) ? 'on' : ''}"></i>`).join('')}</span>`;

type PickerState = { target: PickerTarget; order: number[]; opponent: number; confirm: (action: Command['action']) => void };
let state: PickerState | null = null, host: HTMLElement | null = null, lastView: PlayerView | null = null, dragged: number | null = null;

export function lineupPickerMarkup(view: PlayerView, target: PickerTarget, order: readonly number[], opponent = 0): string | null {
  const content = contentForView(view), spec = pickerSpec(view, target, content);
  if (!spec) return null;
  const all = lineupFighters(view, spec.candidates, content), lineup = lineupFighters(view, order, content);
  const foes = spec.opponents[Math.min(opponent, spec.opponents.length - 1)] ?? [];
  const blocker = pickerBlocker(view, target, order, spec), estimate = lineup.length && spec.opponents.length ? estimateLineup(spec, lineup) : null;
  const pool = all.filter(fighter => !order.includes(fighter.unitId!)).map(fighter => `<li><button type="button" class="lp-candidate" data-add="${fighter.unitId}" aria-label="加入队伍：${esc(content.species[fighter.speciesId]?.name)}">${fighterChip(fighter, content, spec.onSite.includes(fighter.unitId!) ? '<small class="lp-site">在场地上</small>' : '')}</button></li>`).join('');
  const rows = lineup.map((fighter, index) => `<li class="lp-row" draggable="true" tabindex="0" data-index="${index}" data-unit="${fighter.unitId}" aria-label="第 ${index + 1} 位：${esc(content.species[fighter.speciesId]?.name)}（[ ] 调整顺序）">`
    + `<span class="lp-slot">${index + 1}</span>${fighterChip(fighter, content)}<span class="lp-moves"><button type="button" data-up="${index}" aria-label="上移" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" data-down="${index}" aria-label="下移" ${index === lineup.length - 1 ? 'disabled' : ''}>↓</button><button type="button" data-remove="${fighter.unitId}" aria-label="移出队伍">×</button></span></li>`).join('');
  const tabs = spec.opponents.length > 1 ? `<p class="lp-tabs" role="tablist">${spec.opponents.map((_, index) => `<button type="button" role="tab" data-opponent="${index}" aria-selected="${index === opponent}">${esc(spec.names[index] ?? `第 ${index + 1} 队`)}</button>`).join('')}</p>` : '';
  const leader = target.kind === 'gym' ? (() => { const gym = view.expansion?.gymCircuit?.gyms.find(item => item.id === Number(target.key)); return gym ? `${GYM_LEADERS[gym.leader].name} · ${TYPE_NAMES[gym.typeId]}属性 · ${foes.length} 只${STAGE_NAMES[content.species[foes[0]?.speciesId]?.stage ?? 1] ?? ''}` : ''; })() : spec.names[opponent] ?? '';
  const size = spec.size.min === spec.size.max ? `正好 ${spec.size.min} 只` : `${spec.size.min}–${spec.size.max} 只`;
  return `<header><p class="eyebrow">${esc(title(view, target))}</p><button type="button" class="cp-close" id="lineup-close" aria-label="取消（Esc）">×</button></header>
    <p class="lp-rules">单打接力：按顺序一只对一只，倒下由下一只补上；先手看兵种（快速 4 · 侦察 / 飞行 3 · 远程 2 · 近战 / 水面 1 · 攻城 0）；每次出手自动用对当前对手最有效的属性；被对手 ×2 克制而自己打不动时，每方每场自动换一次人。带 ${size}。</p>
    <div class="lp-columns"><section class="lp-pool"><h3>可出战</h3><ul>${pool || '<li class="lp-empty">没有其他可出战的宝可梦</li>'}</ul></section>
    <section class="lp-lineup"><h3>出场顺序</h3><ol id="lineup-order">${rows || '<li class="lp-empty">点左边的宝可梦加入队伍</li>'}</ol></section>
    <section class="lp-foes"><h3>对手${leader ? ` · ${esc(leader)}` : ''}</h3>${tabs}<ul>${foes.map(foe => `<li>${fighterChip(foe, content)}</li>`).join('') || '<li class="lp-empty">对手名单赛前 5 轮公布</li>'}</ul></section></div>
    ${matchupGridMarkup(lineup, foes, content)}
    <div class="lp-estimate"><b id="lineup-estimate">${estimate === null ? '—' : `${estimate}%`}</b>${estimate === null ? '' : bar(estimate)}<small>估计胜率（16 次固定估算，取整到 5%；真实对战的随机在结算时才抽）</small></div>
    ${blocker ? `<p class="cp-reason" id="lineup-blocker">${esc(blocker)}</p>` : ''}
    <footer><button type="button" id="lineup-suggest">建议顺序</button><button type="button" class="primary" id="lineup-confirm" ${blocker ? 'disabled' : ''}>${target.kind === 'championship' ? '报名' : '挑战'}</button></footer>`;
}
function ensureHost(): HTMLElement {
  if (host?.isConnected) return host;
  host = document.createElement('section');
  host.id = 'lineup-picker'; host.className = 'combat-card lineup-picker'; host.hidden = true;
  host.setAttribute('role', 'dialog'); host.setAttribute('aria-label', '选择出场阵容');
  window.addEventListener('keydown', event => {
    if (!state || host?.hidden !== false) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeLineupPicker(); return; }
    const row = (event.target as HTMLElement | null)?.closest<HTMLElement>('.lp-row');
    if (row && (event.key === '[' || event.key === ']')) { event.preventDefault(); move(Number(row.dataset.index), event.key === '[' ? -1 : 1, true); }
  }, { capture: true });
  document.body.append(host);
  return host;
}
function move(index: number, delta: number, focus = false): void {
  if (!state) return;
  const to = index + delta;
  if (to < 0 || to >= state.order.length) return;
  const order = [...state.order];
  [order[index], order[to]] = [order[to], order[index]];
  state.order = order;
  render();
  if (focus) host?.querySelector<HTMLElement>(`.lp-row[data-index="${to}"]`)?.focus();
}
function render(): void {
  if (!state || !lastView) return;
  const body = lineupPickerMarkup(lastView, state.target, state.order, state.opponent), element = ensureHost();
  if (!body) { closeLineupPicker(); return; }
  element.innerHTML = body; element.hidden = false;
  const spec = pickerSpec(lastView, state.target)!;
  element.querySelector('#lineup-close')?.addEventListener('click', closeLineupPicker);
  element.querySelectorAll<HTMLButtonElement>('[data-add]').forEach(button => button.addEventListener('click', () => {
    if (!state || state.order.length >= spec.size.max) return;
    state.order = [...state.order, Number(button.dataset.add)]; render();
  }));
  element.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach(button => button.addEventListener('click', () => {
    if (!state) return;
    state.order = state.order.filter(id => id !== Number(button.dataset.remove)); render();
  }));
  element.querySelectorAll<HTMLButtonElement>('[data-up]').forEach(button => button.addEventListener('click', () => move(Number(button.dataset.up), -1)));
  element.querySelectorAll<HTMLButtonElement>('[data-down]').forEach(button => button.addEventListener('click', () => move(Number(button.dataset.down), 1)));
  element.querySelectorAll<HTMLButtonElement>('[data-opponent]').forEach(button => button.addEventListener('click', () => { if (state) { state.opponent = Number(button.dataset.opponent); render(); } }));
  element.querySelectorAll<HTMLElement>('.lp-row').forEach(row => {
    row.addEventListener('dragstart', () => { dragged = Number(row.dataset.index); });
    row.addEventListener('dragover', event => event.preventDefault());
    row.addEventListener('drop', event => {
      event.preventDefault();
      if (!state || dragged === null) return;
      const order = [...state.order], [item] = order.splice(dragged, 1);
      order.splice(Number(row.dataset.index), 0, item);
      state.order = order; dragged = null; render();
    });
  });
  element.querySelector('#lineup-suggest')?.addEventListener('click', () => {
    if (!state || !lastView) return;
    const choice = chooseLineup(lastView, spec, contentForView(lastView), { fullHp: state.target.kind === 'championship' });
    if (choice) { state.order = choice.unitIds; render(); }
  });
  element.querySelector('#lineup-confirm')?.addEventListener('click', () => {
    if (!state) return;
    const action = pickerAction(state.target, state.order), confirm = state.confirm;
    closeLineupPicker();
    confirm(action);
  });
}
/** The default lineup: the current registration (conference), else on-site Pokémon first, then the others in id order, up to the size. */
function initialOrder(view: PlayerView, target: PickerTarget, spec: LineupSpec): number[] {
  const registered = target.kind === 'championship' ? view.expansion?.civilization.championship.registration?.unitIds.filter(id => spec.candidates.includes(id)) : undefined;
  if (registered?.length) return registered;
  return [...spec.onSite, ...spec.candidates.filter(id => !spec.onSite.includes(id))].slice(0, spec.size.min);
}
export function openLineupPicker(view: PlayerView, target: PickerTarget, confirm: (action: Command['action']) => void): void {
  const spec = pickerSpec(view, target);
  if (!spec) return;
  lastView = view;
  state = { target, order: initialOrder(view, target, spec), opponent: 0, confirm };
  render();
  host?.querySelector<HTMLElement>('#lineup-confirm:not([disabled]), #lineup-suggest')?.focus();
}
/** Re-renders an open picker for a new view (the turn moved on, a unit moved); keeps the chosen order where it still applies. */
export function refreshLineupPicker(view: PlayerView): void {
  if (!state) return;
  lastView = view;
  const spec = pickerSpec(view, state.target);
  if (!spec) { closeLineupPicker(); return; }
  state.order = state.order.filter(id => spec.candidates.includes(id));
  render();
}
export function closeLineupPicker(): void {
  state = null;
  if (host) { host.hidden = true; host.innerHTML = ''; }
}
export const lineupPickerOpen = () => state !== null;
/** Distance helper for callers deciding whether to offer the picker (an own Pokémon within 2 tiles of a site). */
export const nearSite = (view: PlayerView, position: { q: number; r: number }) => view.units.some(unit => unit.ownerId === view.playerId && unit.kind === 'pokemon' && hexDistance(unit.position, position, view.map) <= 2);
/** Conference team size (for labels). */
export const CONFERENCE_SIZE = CIVILIZATION_CONTENT.championship.teamSize;
