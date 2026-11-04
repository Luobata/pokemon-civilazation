// v20 attack preview: the Civilization-style strength comparison (each side's strength, every flat bonus, the gap).
import type { StrengthBreakdown } from '../core/strength.ts';

const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(value)}`;
export function strengthTotals(breakdown: StrengthBreakdown) {
  const sum = (side: 'attack' | 'defense') => breakdown.factors.filter(factor => factor.side === side).reduce((total, factor) => total + factor.value, 0);
  return { attack: breakdown.attack + sum('attack'), defense: breakdown.defense + sum('defense') };
}
export function strengthMarkup(breakdown: StrengthBreakdown, attackerName: string, defenderName: string): string {
  if (breakdown.logistics) return '<p class="strength-note">职能单位没有战斗力：一击即散。</p>';
  const totals = strengthTotals(breakdown);
  const side = (name: string, base: number, total: number, which: 'attack' | 'defense') => `<div class="strength-side"><p><b>${name}</b><span>战斗力 ${base}</span></p>
    <ul>${breakdown.factors.filter(factor => factor.side === which).map(factor => `<li>${factor.label}<span>${factor.label.startsWith('属性无效') ? '无效' : signed(factor.value)}</span></li>`).join('')}</ul>
    <p class="strength-total">= ${total}</p></div>`;
  return `<div class="strength-breakdown" id="strength-breakdown">${side(attackerName, breakdown.attack, totals.attack, 'attack')}${side(defenderName, breakdown.defense, totals.defense, 'defense')}
    <p class="strength-gap">${breakdown.immune ? '属性无效：造成 0 伤害' : `差 ${signed(breakdown.gap)}：每 +5 约多 20% 伤害`}</p></div>`;
}
