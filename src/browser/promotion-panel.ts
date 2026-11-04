import { PROMOTION_RULES, PROMOTION_TRAITS, PROMOTION_TRAIT_IDS } from '../content/promotions.ts';
import type { PromotionTrait } from '../content/promotions.ts';
import { nextThreshold, pendingPromotions } from '../core/promotions.ts';
import type { PlayerView } from '../core/model.ts';

/** One-line trait list for any visible unit (traits are public). */
export function promotionLine(view: PlayerView, unitId: number): string | null {
  const record = view.expansion?.promotions?.units[unitId];
  if (!record) return null;
  const traits = record.traits.map(trait => PROMOTION_TRAITS[trait].name).join('、');
  if (record.merit === undefined) return traits ? `特性：${traits}` : null;
  return `战功 ${record.merit}${traits ? ` · 特性：${traits}` : ''}`;
}

/** Unit panel section: merit progress, owned traits, and a choice when a promotion is pending. */
export function promotionMarkup(view: PlayerView, unitId: number, busy: boolean): string {
  if (!view.expansion?.promotions) return '';
  const shown = view.expansion.promotions.units[unitId], record = { merit: shown?.merit ?? 0, traits: shown?.traits ?? [] as PromotionTrait[] };
  const pending = pendingPromotions(record), next = nextThreshold(record.merit);
  const previous = [0, ...PROMOTION_RULES.thresholds].filter(threshold => threshold <= record.merit).at(-1)!;
  const progress = next === null || pending ? 100 : Math.floor((record.merit - previous) * 100 / (next - previous));
  const owned = record.traits.map(trait => `<span class="promotion-trait" title="${PROMOTION_TRAITS[trait].summary}">${PROMOTION_TRAITS[trait].name}</span>`).join('');
  const choices = pending ? PROMOTION_TRAIT_IDS.filter(trait => !record.traits.includes(trait))
    .map(trait => `<button type="button" data-promote="${trait}" ${busy ? 'disabled' : ''}><strong>${PROMOTION_TRAITS[trait].name}</strong><small>${PROMOTION_TRAITS[trait].summary}</small></button>`).join('') : '';
  const m = PROMOTION_RULES.merit;
  return `<section class="promotion-box${pending ? ' ready' : ''}" id="promotion-box" aria-label="晋升"><p class="section-label">晋升 · 战功 ${record.merit}${next === null ? '（已满 3 次）' : ` / ${next}`}</p>
    <span class="vital-bar merit" aria-hidden="true"><span style="width:${progress}%"></span></span>
    ${owned ? `<div class="promotion-traits">${owned}</div>` : ''}
    ${pending ? `<p class="unit-note promotion-ready">可以晋升${pending > 1 ? ` ${pending} 次` : ''}：选择一个特性（不消耗行动）。</p><div class="promotion-choices">${choices}</div>`
      : `<p class="unit-note">战功来自战斗：主动攻击造成伤害 +${m.attack}，反击 +${m.counter}，击倒 +${m.knockdown}，攻下城市 +${m.cityCaptured}。达到 ${PROMOTION_RULES.thresholds.join(' / ')} 时晋升。</p>`}</section>`;
}
