// P0-4 CombatPreviewCard (docs/design/review-2026-11/5-ui.md §4): a floating card on the map, next to the chosen
// attack target, that answers "what happens if I attack?" at a glance — both sides' combat strength with every
// labelled bonus, the strength gap, and each side's HP after the hit (and the counter-attack). Clicking the same
// target again (or the card's 攻击 button) confirms; Esc or clicking elsewhere cancels. Reads previewAttack as-is.
import { signed, strengthTotals } from './strength-panel.ts';
import { pokemonSpritePath } from './sprites.ts';
import { ROLE_POKEMON } from '../content/roles.ts';
import { unitDefinition, contentForView } from '../content/units.ts';
import type { CombatTarget, MapUnit, PlayerView } from '../core/model.ts';
import { previewAttack } from '../core/preview.ts';
import type { AttackPreview } from '../core/preview.ts';
import type { StrengthBreakdown } from '../core/strength.ts';

type Rect = { left: number; top: number; width: number; height: number };
type Side = { name: string; owner: string; sprite: string; hp: number; maxHp: number };
export type CombatCard = { attacker: Side; defender: Side; city: boolean; preview: AttackPreview };

const REASONS: Record<string, string> = { 'at-peace': '和平中：先在外交页面宣战才能攻击。', 'out-of-range': '不在射程内。', 'attack-unavailable': '现在不能攻击。' };
const ownerLabel = (ownerId: number | null) => ownerId === null ? '野生' : `文明 ${ownerId + 1}`;
function unitSide(unit: MapUnit, view: PlayerView): Side {
  const content = contentForView(view);
  if (unit.kind === 'pokemon') return { name: unitDefinition(unit, content).name, owner: ownerLabel(unit.ownerId), sprite: pokemonSpritePath(unit.speciesId), hp: unit.hp, maxHp: content.species[unit.speciesId].maxHp };
  return { name: ROLE_POKEMON[unit.role].unitName, owner: ownerLabel(unit.ownerId), sprite: ROLE_POKEMON[unit.role].sprite, hp: unit.hp, maxHp: Math.max(1, unit.hp) };
}

/** What the card shows for the selected unit against one target, or null when there is nothing to compare. */
export function combatCard(view: PlayerView, unitId: number, target: CombatTarget): CombatCard | null {
  const unit = view.units.find(item => item.id === unitId && item.ownerId === view.playerId);
  if (!unit) return null;
  const preview = previewAttack(view, unit.id, target);
  if (target.kind === 'unit') {
    const defender = view.units.find(item => item.id === target.id);
    return defender ? { attacker: unitSide(unit, view), defender: unitSide(defender, view), city: false, preview } : null;
  }
  const city = view.cities.find(item => item.id === target.id);
  if (!city) return null;
  // Enemy buildings are hidden, so a city's full HP is unknown: use the base HP (or the current HP if higher).
  const hp = view.combat.cities[city.id]?.hp ?? 0;
  return { attacker: unitSide(unit, view), city: true, preview,
    defender: { name: `城市 ${city.id}`, owner: ownerLabel(city.ownerId), sprite: '/buildings/headquarters.svg', hp, maxHp: Math.max(hp, contentForView(view).balance.city.baseHp) } };
}

const pct = (value: number, total: number) => `${Math.max(0, Math.min(100, value * 100 / Math.max(1, total)))}%`;
/** HP bar after a hit of min–max: what surely remains, the min–max band, what surely goes, and HP already lost. */
function hpBar(side: Side, min: number, max: number, id: string, tag = ''): string {
  const low = Math.max(0, side.hp - max), high = Math.max(0, side.hp - min);
  const after = low === high ? `${low}` : `${low}–${high}`;
  return `<div class="cp-hp" id="${id}" data-hp-before="${side.hp}" data-hp-after-min="${low}" data-hp-after-max="${high}">
    <p>${tag}<span>${side.name}</span><b>HP ${side.hp} → <em>${after}</em></b></p>
    <span class="cp-bar" aria-hidden="true"><i class="keep" style="width:${pct(low, side.maxHp)}"></i><i class="band" style="width:${pct(high - low, side.maxHp)}"></i><i class="lost" style="width:${pct(side.hp - high, side.maxHp)}"></i></span></div>`;
}
function sideMarkup(side: Side, which: 'attack' | 'defense', breakdown: StrengthBreakdown | undefined): string {
  const totals = breakdown ? strengthTotals(breakdown) : null;
  const factors = breakdown?.factors.filter(factor => factor.side === which) ?? [];
  const strength = breakdown && !breakdown.logistics ? `<p class="cp-base">战斗力<b>${which === 'attack' ? breakdown.attack : breakdown.defense}</b></p>
    <ul class="cp-factors">${factors.map(factor => `<li><span>${factor.label}</span><b class="${factor.value < 0 ? 'neg' : 'pos'}">${factor.label.startsWith('属性无效') ? '无效' : signed(factor.value)}</b></li>`).join('')}</ul>
    <p class="cp-total">合计<b>${which === 'attack' ? totals!.attack : totals!.defense}</b></p>` : '';
  return `<div class="cp-side cp-${which}" data-side="${which}"><div class="cp-who"><span class="cp-sprite"><img src="${side.sprite}" alt="${side.name}" width="40" height="40"></span><p><strong>${side.name}</strong><small>${side.owner} · HP ${side.hp}/${side.maxHp}</small></p></div>${strength}</div>`;
}
export function combatCardMarkup(card: CombatCard, disabled: boolean): string {
  const { preview } = card;
  const head = `<header><p class="eyebrow">战斗预览</p><button type="button" class="cp-close" id="combat-card-close" aria-label="取消攻击（Esc）" title="取消（Esc）">×</button></header>`;
  if (!preview.ok) return `${head}<p class="cp-reason">${REASONS[preview.reason] ?? '现在不能攻击。'}</p>`;
  const breakdown = preview.strength, gap = breakdown ? breakdown.gap : null;
  const centre = breakdown?.logistics ? '<b class="cp-gap">—</b><small>职能单位一击即散</small>'
    : breakdown?.immune ? '<b class="cp-gap neg">无效</b><small>属性无效：0 伤害</small>'
    : gap !== null ? `<b class="cp-gap ${gap > 0 ? 'pos' : gap < 0 ? 'neg' : ''}" id="combat-card-gap">${signed(gap)}</b><small>战斗力差<br>每 +5 约多 20% 伤害</small>`
    : `<b class="cp-gap">${preview.damage.min}–${preview.damage.max}</b><small>预计伤害</small>`;
  const knockdown = preview.knockdown === 'guaranteed' ? (card.city ? '必定攻下' : '必定击倒') : preview.knockdown === 'possible' ? (card.city ? '可能攻下' : '可能击倒') : '';
  const counter = preview.counter.trigger === 'never' ? '<p class="cp-counter" id="combat-card-counter" data-counter="0">无反击</p>'
    : hpBar(card.attacker, preview.counter.damage, preview.counter.damage, 'combat-card-counter',
      `<span class="cp-tag" data-counter="${preview.counter.damage}">${preview.counter.trigger === 'possible' ? '可能反击' : '反击'} −${preview.counter.damage}</span>`);
  return `${head}<div class="cp-columns">${sideMarkup(card.attacker, 'attack', breakdown)}<div class="cp-centre">${centre}</div>${sideMarkup(card.defender, 'defense', breakdown)}</div>
    <div class="cp-result"><p class="cp-damage" id="combat-card-damage" data-min="${preview.damage.min}" data-max="${preview.damage.max}">伤害 <b>${preview.damage.min}–${preview.damage.max}</b>${knockdown ? `<span class="cp-tag ko">${knockdown}</span>` : ''}</p>
    ${hpBar(card.defender, preview.damage.min, preview.damage.max, 'combat-card-target')}${counter}</div>
    <footer><small>再次点击目标也可攻击 · Esc 取消</small><button type="button" class="primary" id="combat-card-attack" ${disabled ? 'disabled' : ''}>攻击</button></footer>`;
}

const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left))
  * Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
/** Where to put the card: beside the target, inside the map, off the target and the map's fixed overlays. Pure. */
export function placeCard(size: { width: number; height: number }, anchor: { x: number; y: number }, area: { width: number; height: number },
  obstacles: readonly Rect[], radius: number, margin = 8): { left: number; top: number } {
  const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
  const gap = radius + 10, { width, height } = size;
  const candidates = [
    { left: anchor.x + gap, top: anchor.y - height / 2 }, { left: anchor.x - gap - width, top: anchor.y - height / 2 },
    { left: anchor.x - width / 2, top: anchor.y - gap - height }, { left: anchor.x - width / 2, top: anchor.y + gap },
    { left: anchor.x + gap, top: anchor.y - gap - height }, { left: anchor.x - gap - width, top: anchor.y - gap - height },
    { left: anchor.x + gap, top: anchor.y + gap }, { left: anchor.x - gap - width, top: anchor.y + gap },
  ];
  // On small maps none of the spots beside the target may be free: also try a coarse grid over the whole map.
  const step = 16;
  for (let top = margin; top <= area.height - height - margin; top += step) for (let left = margin; left <= area.width - width - margin; left += step) candidates.push({ left, top });
  const spots = candidates.map(spot => ({ left: Math.round(clamp(spot.left, margin, area.width - width - margin)), top: Math.round(clamp(spot.top, margin, area.height - height - margin)) }));
  const target: Rect = { left: anchor.x - radius, top: anchor.y - radius, width: radius * 2, height: radius * 2 };
  // Covering the target or an overlay costs far more than distance, so the nearest free spot wins; beside-the-target spots win ties.
  const score = (spot: { left: number; top: number }) => {
    const rect = { ...spot, width, height };
    const covered = overlap(rect, target) * 50 + obstacles.reduce((sum, obstacle) => sum + overlap(rect, obstacle), 0);
    return covered * 1000 + Math.hypot(spot.left + width / 2 - anchor.x, spot.top + height / 2 - anchor.y);
  };
  return spots.reduce((best, spot) => score(spot) < score(best) ? spot : best);
}

export type CombatCardCallbacks = { confirm: () => void; cancel: () => void };
let host: HTMLElement | null = null, lastMarkup = '', callbacks: CombatCardCallbacks | null = null;
function ensureHost(): HTMLElement | null {
  if (host?.isConnected) return host;
  const frame = document.querySelector<HTMLElement>('.map-frame');
  if (!frame) return null;
  host = document.createElement('section');
  host.id = 'combat-card'; host.className = 'combat-card'; host.hidden = true;
  host.setAttribute('role', 'dialog'); host.setAttribute('aria-label', '战斗预览');
  host.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest('button');
    if (button?.id === 'combat-card-attack') callbacks?.confirm();
    else if (button?.id === 'combat-card-close') callbacks?.cancel();
  });
  host.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); callbacks?.cancel(); } });
  frame.append(host); lastMarkup = '';
  return host;
}
/** On wide maps the bottom-right corner is reserved for the unit action bar (P0-3); the toolbar, notices, end-turn
 *  block and the (sticky, on narrow screens) top bar are measured where they overlap the map. */
const RESERVED_CORNER = { width: 340, height: 170 };
function obstacles(frame: DOMRect, area: { width: number; height: number }): Rect[] {
  const rects: Rect[] = area.width >= 720 ? [{ left: area.width - RESERVED_CORNER.width, top: area.height - RESERVED_CORNER.height, ...RESERVED_CORNER }] : [];
  for (const element of document.querySelectorAll<HTMLElement>('.topbar, .map-toolbar, .hud-notices, .turn-block, #unit-action-bar, #opening-goals, .map-legend, #toast-host')) {
    const box = element.getBoundingClientRect();
    if (box.width && box.height) rects.push({ left: box.left - frame.left, top: box.top - frame.top, width: box.width, height: box.height });
  }
  return rects;
}
/** Shows, updates or hides the card. `anchor` is the target's centre in canvas pixels; `radius` the on-screen hex radius. */
export function renderCombatCard(card: CombatCard | null, anchor: { x: number; y: number } | null, radius: number, disabled: boolean, handlers: CombatCardCallbacks): void {
  const element = ensureHost();
  if (!element) return;
  callbacks = handlers;
  if (!card || !anchor) { if (!element.hidden) { element.hidden = true; element.innerHTML = ''; lastMarkup = ''; } return; }
  const markup = combatCardMarkup(card, disabled);
  if (markup !== lastMarkup) { element.innerHTML = markup; lastMarkup = markup; }
  element.hidden = false;
  const canvas = element.parentElement!.querySelector<HTMLCanvasElement>('#map'), frame = element.parentElement!.getBoundingClientRect();
  const area = { width: canvas?.clientWidth ?? frame.width, height: canvas?.clientHeight ?? frame.height };
  element.style.maxHeight = `${Math.max(120, area.height - 16)}px`;
  const spot = placeCard({ width: element.offsetWidth, height: element.offsetHeight }, anchor, area, obstacles(frame, area), radius);
  element.style.transform = `translate(${spot.left}px, ${spot.top}px)`;
}
