// Gameplay v27 ⑤ in the browser (docs/design/pace-v27.md §6.4): the Max raid's shield pips, phase, reward preview and contribution
// ledger on the World page (next-action raid card and the 极巨团体战 section), and the free den Dynamax button. Presentation only: every
// number comes from the PlayerView through the same functions the authority and the AI use (src/core/max-raids.ts).
import { lateTuning } from '../content/depth-v26.ts';
import { eventsTuning } from '../content/pace-v27.ts';
import type { Content } from '../content/units.ts';
import { MAX_RAID_REASONS, RAID_ROLE_NAMES, raidPreview, viewRaidDynamaxBlocker } from '../core/max-raids.ts';
import type { RaidPreview } from '../core/max-raids.ts';
import type { Command, PlayerView } from '../core/model.ts';
import { planMaxRaidAction } from '../ai/max-raid-plan.ts';
import { pokemonSpritePath } from './sprites.ts';
import { artImage, escapeAttr, flagImage, statChip, uiIcon } from './ui-icons.ts';
import { civColor, civOrYou } from './civ-names.ts';

const esc = escapeAttr;
/** Shield pips: one `shield` icon per standing shield, dimmed ones for the broken (named as a whole). */
export function shieldPips(shields: number, max: number, size = 14): string {
  const label = `极巨护盾 ${shields}/${max}`;
  return `<span class="max-shields" role="img" aria-label="${label}" title="${label}">${Array.from({ length: max }, (_, index) =>
    uiIcon('shield', { size, className: index < shields ? 'on' : 'off' })).join('')}</span>`;
}
/** One-line reward preview: 第一 / 你的捕捉率 / 金币 (the numbers if the boss fell now). */
export function rewardLine(view: PlayerView, preview: RaidPreview, content: Content): string {
  const name = content.species[preview.catchSpeciesId]?.name ?? '';
  const chance = preview.leading ? '你领先：必得这只宝可梦' : preview.catchChance !== null ? `你 ${preview.sharePercent}% → 捕捉率 ${preview.catchChance}%（${name}）`
    : `你 ${preview.sharePercent}%（贡献 ≥ ${lateTuning(content).raidMinSharePercent}% 才有捕捉机会）`;
  return `${preview.leading ? '' : `第一必得首领 + 时代分 +1；`}${chance}；金币 +${preview.gold}`;
}
/** Status, extra tip lines and the Dynamax action for the next-action raid card (null before v27 or with no open Max den). */
export function maxRaidCardParts(view: PlayerView, content: Content): { status: string; tip: string; action?: { label: string; command: Command['action']; available: boolean; reason?: string } } | null {
  const preview = raidPreview(view, content);
  if (!preview) return null;
  const tuning = eventsTuning(content);
  const shields = preview.shields === null ? '护盾 ?' : `护盾 ${preview.shields}/${preview.shieldMax}`;
  const phase = preview.phase === 2 ? ' · 第二阶段' : '';
  const dynamax = planMaxRaidAction(view, content);
  const used = view.expansion?.raids?.active?.max?.dynamaxUsed;
  return {
    status: `${shields}${phase} · ${preview.leading ? '你领先' : preview.catchChance !== null ? `捕捉率 ${preview.catchChance}%` : `你 ${preview.sharePercent}%`}`,
    tip: `极巨团体战：首领带 ${preview.shieldMax ?? '?'} 格极巨护盾，护盾在时伤害只算 ${tuning.shieldDamagePermille / 10}%；每次命中打掉 1 格，效果拔群或破盾手（近战、快速、攻城）打掉 ${tuning.breakerShields} 格。`
      + `HP 降到 ${tuning.phaseTwoPercent}% 进入第二阶段：护盾回到 ${tuning.shieldPhaseTwo} 格，轮末的极巨波打 ${tuning.phaseTwoRange} 格内所有单位。\n`
      + `输出（远程、飞行、水面）在护盾打完后伤害 ×1.25；支援（侦察）每轮末给 1 格内的己方宝可梦回复 ${tuning.supportHeal} HP。贡献 = 伤害 + ${tuning.shieldPoints} × 破盾 + 回复。\n`
      + `奖励预览：${rewardLine(view, preview, content)}。\n`
      + `每个文明每次团体战可以免费极巨化一只巢穴 ${tuning.dynamaxRange} 格内的宝可梦（伤害 +30%、受到伤害 −30%，到团体战结束）${used ? '，你已经用过' : ''}。`,
    ...(dynamax ? { action: { label: '极巨化', command: dynamax, available: true } } : {}),
  };
}
/** The World page section: the boss, its shields and HP, the reward preview, the ledger and the Dynamax button ('' without an open Max den). */
export function maxRaidPanelMarkup(view: PlayerView, button: (label: string, action: Command['action'], available?: boolean, reason?: string) => string, content: Content): string {
  const active = view.expansion?.raids?.active, preview = raidPreview(view, content);
  if (!active?.max || !preview) return '';
  const name = content.species[active.speciesId]?.name ?? '', max = active.max;
  const hp = preview.hp ?? active.maxHp, width = Math.round(hp * 100 / Math.max(1, active.maxHp));
  const catchName = content.species[preview.catchSpeciesId]?.name ?? '';
  const ledger = Object.entries(max.contribution).map(([id, value]) => ({ id: Number(id), value })).sort((a, b) => b.value - a.value || a.id - b.id);
  const rows = ledger.map(row => {
    const share = preview.total ? Math.round(row.value * 100 / preview.total) : 0, who = civOrYou(view, row.id);
    return `<li class="raid-ledger-row${row.id === view.playerId ? ' own' : ''}">${flagImage(civColor(row.id), { size: 16, label: who })}<span class="raid-ledger-name">${esc(who)}</span>`
      + `<span class="raid-bar" role="img" aria-label="贡献 ${row.value}（${share}%）" title="贡献 ${row.value}（${share}%）"><span style="width:${share}%"></span></span>`
      + `${statChip('swords', active.damage[row.id] ?? 0, '伤害')}${statChip('shield', max.broken[row.id] ?? 0, '打掉的护盾')}${statChip('heart', max.healed[row.id] ?? 0, '支援回复')}<b>${share}%</b></li>`;
  }).join('');
  const team = preview.team.slice(0, 4).map(member => {
    const unit = view.units.find(item => item.id === member.unitId);
    return unit && unit.kind === 'pokemon' ? `<span class="raid-member">${artImage(pokemonSpritePath(unit.speciesId), { size: 24, label: `${content.species[unit.speciesId].name}（${RAID_ROLE_NAMES[member.role]}）` })}${esc(RAID_ROLE_NAMES[member.role])} ≈${member.perRound}</span>` : '';
  }).join('');
  const dynamax = planMaxRaidAction(view, content);
  const nearest = preview.team[0], blocker = nearest ? viewRaidDynamaxBlocker(view, nearest.unitId, content) : 'raid-dynamax-range';
  return `<section class="max-raid${preview.phase === 2 ? ' phase-two' : ''}" aria-label="极巨团体战"><h3 class="next-head">${uiIcon('raid', { size: 18 })}极巨团体战 · ${esc(name)}${preview.phase === 2 ? ' · 第二阶段' : ''}</h3>
    <div class="max-raid-boss">${artImage(pokemonSpritePath(active.speciesId), { size: 64, label: name, className: 'max-raid-sprite' })}
      <div class="max-raid-meters">${preview.shields === null ? '<span class="unit-note">护盾：探索过巢穴才看得见</span>' : shieldPips(preview.shields, preview.shieldMax ?? preview.shields)}
        <span class="hp-bar max-hp${preview.phase === 2 ? ' phase-two' : ''}" role="img" aria-label="HP ${hp}/${active.maxHp}" title="HP ${hp}/${active.maxHp}"><span style="width:${width}%"></span></span>
        <span class="unit-note">第 ${active.endsAtRound} 轮后离开</span></div></div>
    <ul class="raid-rewards">
      <li>${uiIcon('trophy', { size: 18, label: '贡献第一' })}<span>第一：必得</span>${artImage(pokemonSpritePath(active.speciesId), { size: 24, label: name })}${statChip('eraScore', '+1', '时代分')}</li>
      <li>${uiIcon('pokeBall', { size: 18, label: '捕捉机会' })}<span>${esc(preview.leading ? '你领先：必得' : preview.catchChance !== null ? `你 ${preview.sharePercent}% → 捕捉率 ${preview.catchChance}%` : `你 ${preview.sharePercent}%：贡献 ≥ ${lateTuning(content).raidMinSharePercent}% 才有捕捉机会`)}</span>${artImage(pokemonSpritePath(preview.catchSpeciesId), { size: 24, label: `捕捉成功得到${catchName}` })}</li>
      <li>${uiIcon('gold', { size: 18, label: '金币' })}<span>金币 +${preview.gold}（每 10% 份额 ${lateTuning(content).raidShareGold}，最多 ${lateTuning(content).raidMaxGold}；没打倒时 ≥ 10% 得 ${eventsTuning(content).participationGold}）</span></li>
    </ul>
    <ol class="raid-ledger" aria-label="贡献账本">${rows || '<li class="unit-note">还没有人出手</li>'}</ol>
    ${team ? `<p class="raid-team">附近的队伍：${team}</p>` : ''}
    <p>${dynamax ? button('极巨化（团体战，免费）', dynamax) : button('极巨化（团体战，免费）', { type: 'RaidDynamax', unitId: nearest?.unitId ?? 0 }, false, MAX_RAID_REASONS[blocker ?? ''] ?? '')}</p></section>`;
}
