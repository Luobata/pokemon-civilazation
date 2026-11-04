// What the selected unit could do to the things on one tile: attack damage, counter-attack,
// capture chance, or why not. Reuses previewAttack/previewCapture (player knowledge only). Pure.
import { strengthTotals } from './strength-panel.ts';
import { classModifierLabels } from '../core/unit-classes.ts';
import { unitDefinition, contentForView } from '../content/units.ts';
import type { BallId } from '../content/economy.ts';
import { hexDistance, hexToIndex } from '../core/hex.ts';
import type { Command, PlayerView } from '../core/model.ts';
import { previewAttack, previewCapture } from '../core/preview.ts';

export type PreviewOption = { label: string; ok: boolean; text: string; action?: Command['action']; /** Tooltip form, only when ok. */ short?: string };
/** Keyed like the tile entities: `unit:<id>` or `city:<id>`. */
export type TargetPreview = { key: string; attacker: string; options: PreviewOption[] };

const BALL_NAMES: Record<BallId, string> = { pokeBall: '精灵球', greatBall: '超级球' };

export function targetPreviews(view: PlayerView, unitId: number | null, index: number): TargetPreview[] {
  const unit = unitId === null ? undefined : view.units.find(item => item.id === unitId && item.ownerId === view.playerId);
  if (!unit) return [];
  const content = contentForView(view);
  const at = (position: { q: number; r: number }) => hexToIndex(position, view.map) === index;
  const attacker = unitDefinition(unit, content).name;
  const generic = unit.kind !== 'pokemon' ? '开拓队不能战斗。' : !unit.actionLeft ? `${attacker}本回合已行动。`
    : view.activePlayerId !== view.playerId ? '现在不是你的回合。' : view.outcome ? '对局已结束。' : null;
  const range = unit.kind === 'pokemon' ? content.species[unit.speciesId].range : 0;
  const attackOption = (kind: 'unit' | 'city', id: number, position: { q: number; r: number }, hp: number, logistics: boolean): PreviewOption => {
    const preview = previewAttack(view, unit.id, { kind, id });
    if (preview.ok) {
      const knockdown = preview.knockdown === 'guaranteed' ? (kind === 'city' ? ' · 必定攻下' : ' · 必定击倒') : preview.knockdown === 'possible' ? (kind === 'city' ? ' · 可能攻下' : ' · 可能击倒') : '';
      const counter = preview.counter.trigger === 'never' ? '无反击' : `${preview.counter.trigger === 'possible' ? '可能' : ''}反击 −${preview.counter.damage}（你的 HP ${unit.hp}）`;
      const defender = kind === 'unit' ? view.units.find(item => item.id === id) ?? null : null;
      const totals = preview.strength ? strengthTotals(preview.strength) : null;
      const modifiers = totals ? ` · 战斗力 ${totals.attack} 对 ${totals.defense}` : classModifierLabels(view, unit, defender, content).map(label => ` · ${label}`).join('');
      return { label: '攻击', ok: true, text: `伤害 ${preview.damage.min}–${preview.damage.max}（对方 HP ${hp}）${knockdown} · ${counter}${modifiers}`, action: { type: 'Attack', unitId: unit.id, target: { kind, id } }, short: `攻击 ${preview.damage.min}–${preview.damage.max}` };
    }
    const distance = hexDistance(unit.position, position);
    const text = generic ?? (preview.reason === 'at-peace' ? '和平中：先在外交页面宣战才能攻击。'
      : preview.reason === 'out-of-range' ? (logistics && distance > 1 ? `开拓队只能贴身攻击（现在距离 ${distance}）。` : `不在射程内：距离 ${distance}，射程 ${range}。先移动靠近。`)
      : '现在不能攻击。');
    return { label: '攻击', ok: false, text };
  };
  const results: TargetPreview[] = [];
  for (const target of view.units.filter(item => at(item.position) && item.ownerId !== view.playerId)) {
    const options = [attackOption('unit', target.id, target.position, target.hp, target.kind === 'logistics')];
    if (target.ownerId === null && target.kind === 'pokemon' && unit.kind === 'pokemon') {
      const player = view.economy.player, distance = hexDistance(unit.position, target.position);
      for (const ballId of Object.keys(content.balls) as BallId[]) {
        if (!player.research.unlockedIds.includes(content.balls[ballId].requiredTech) && ballId !== 'pokeBall') continue;
        const preview = previewCapture(view, unit.id, target.id, ballId), label = `用${BALL_NAMES[ballId]}捕捉`;
        if (preview.ok) { options.push({ label, ok: true, text: `成功率 ${preview.probability}% · 剩 ${player.ballInventory[ballId]} 个`, action: { type: 'Capture', unitId: unit.id, targetUnitId: target.id, ballId }, short: `${BALL_NAMES[ballId]} ${preview.probability}%` }); continue; }
        const text = generic ?? (distance !== 1 ? `需要相邻才能捕捉（现在距离 ${distance}）。`
          : !player.research.unlockedIds.includes('domestication') ? '先研究「驯化」。'
          : player.ballInventory[ballId] < 1 ? `没有${BALL_NAMES[ballId]}：在城市的「物资采购」里购买。` : '现在不能捕捉。');
        options.push({ label, ok: false, text });
      }
    }
    results.push({ key: `unit:${target.id}`, attacker, options });
  }
  const city = view.cities.find(item => at(item.position) && item.ownerId !== view.playerId);
  if (city) results.push({ key: `city:${city.id}`, attacker, options: [attackOption('city', city.id, city.position, view.combat.cities[city.id]?.hp ?? 0, false)] });
  return results;
}

/** Short suffix for the hover tooltip, e.g. "攻击 12–15 · 捕捉 45%". */
export function previewSummary(previews: readonly TargetPreview[]): string {
  return previews.flatMap(preview => preview.options.flatMap(option => option.short ? [option.short] : [])).join(' · ');
}
