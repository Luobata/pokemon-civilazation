// Gameplay v24 B / C UI (docs/design/world-v24.md §3.5, §4.4): gym and rival-warning tile entries, the badge box and rival card of the
// world panel, the unit bar's 挑战道馆 action and its floating preview card (the combat card's look and placement). PlayerView only.
import { ELITE_FOUR, GYM_LEADERS, GYM_RULES_V24, STAGE_NAMES } from '../content/gym-circuit.ts';
import { ESSENCES } from '../content/essences.ts';
import { RIVAL_RULES_V24 } from '../content/rivals.ts';
import { TYPE_NAMES } from '../content/type-names.ts';
import { contentForView, unitDefinition } from '../content/units.ts';
import { gymAt, leaderTeamFor, unitPower, viewEliteFourBlocker, viewGymBlocker, viewGymTeam } from '../core/gym-circuit.ts';
import type { GymSite } from '../core/gym-circuit.ts';
import { rivalLines, viewRivalSighting } from '../core/rivals.ts';
import { hexToIndex } from '../core/hex.ts';
import type { Command, MapUnit, PlayerView } from '../core/model.ts';
import { placeCard } from './combat-preview.ts';
import { pokemonSpritePath } from './sprites.ts';
import { typeBadge, uiIcon } from './ui-icons.ts';
import type { TileEntity } from './tile-info.ts';

const esc = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const civ = (view: PlayerView, id: number) => id === view.playerId ? '你' : `文明 ${id + 1}`;
export const gymTitle = (gym: GymSite) => `${GYM_LEADERS[gym.leader].name}的${ESSENCES[gym.essence].name}道馆`;
const badgesOf = (view: PlayerView) => view.expansion?.gymCircuit?.badges[view.playerId] ?? [];
/** "2 只一阶 · 战力 300": the viewer's next leader team (the same at every gym, §3.1 5A). */
export function nextLeaderText(view: PlayerView): string {
  const row = leaderTeamFor(badgesOf(view).length);
  return `${row.members} 只${STAGE_NAMES[row.stage]} · 战力 ${row.power}`;
}
const blockerText: Record<string, string> = {
  'gym-won': '你已经拿到这枚徽章。', 'gym-cooldown': '同一道馆每 3 轮只能挑战一次。', 'invalid-team': '要带 1–3 只宝可梦。',
  'unit-not-local': '队伍里的宝可梦都要有行动，并在道馆 2 格内。', 'unit-not-on-site': '至少一只宝可梦要站在道馆上。', 'not-your-turn': '现在不是你的回合。',
  'elite-locked': `集齐 ${GYM_RULES_V24.gymCount} 枚巡回徽章后才能挑战。`, 'elite-won': '你已经战胜过四天王（每局一次）。', 'elite-cooldown': `每 ${GYM_RULES_V24.eliteFour.cooldownRounds} 轮只能挑战一次。`,
  'unit-unavailable': `需要 ${GYM_RULES_V24.eliteFour.team} 只有行动的宝可梦。`, 'gym-unavailable': '这里没有道馆。', 'gyms-unavailable': '本局没有道馆巡回。',
};
export const gymBlockerText = (reason: string) => blockerText[reason] ?? '现在不能挑战。';

// ---------- tile inspector ----------

/** The gym on this tile and, for the target only, the rival's warning. */
export function v24TileEntities(view: PlayerView, index: number): (TileEntity & { action?: { label: string; command: Command['action'] | null; reason?: string } })[] {
  const entities: (TileEntity & { action?: { label: string; command: Command['action'] | null; reason?: string } })[] = [];
  const circuit = view.expansion?.gymCircuit, gym = gymAt(circuit, index);
  if (gym && circuit) {
    const holders = Object.entries(circuit.badges).filter(([, list]) => list.includes(gym.id)).map(([id]) => civ(view, Number(id)));
    const won = badgesOf(view).includes(gym.id), team = viewGymTeam(view, gym.id, contentForView(view));
    const reason = won ? 'gym-won' : team.length ? viewGymBlocker(view, gym.id, team) : 'unit-not-on-site';
    entities.push({ kind: 'gym', tone: 'neutral', title: `巡回道馆 · ${GYM_LEADERS[gym.leader].name}（${TYPE_NAMES[gym.typeId]}）`,
      subtitle: `${ESSENCES[gym.essence].name}徽章${gym.homeOf !== undefined ? ` · ${civ(view, gym.homeOf)}的家门口道馆` : ''}${gym.overseas ? ' · 海外' : ''}`,
      lines: [won ? '你已赢得这枚徽章 ✓' : `你的下一位馆主：${nextLeaderText(view)}（馆主强度随你已有的徽章数提高）`,
        `胜利：徽章、金币 ${GYM_RULES_V24.reward.goldPerBadge} × 第几枚、${ESSENCES[gym.essence].name}精华 +${GYM_RULES_V24.reward.essence}、参战宝可梦经验 +${GYM_RULES_V24.reward.xp}。`,
        `已获得这枚徽章：${holders.join('、') || '还没有人'}`],
      hint: won ? undefined : '挑战需要 1–3 只宝可梦：一只站在道馆上，其余在 2 格内；同一道馆每 3 轮一次。',
      ...(won ? {} : { action: { label: `挑战${GYM_LEADERS[gym.leader].name}`, command: reason ? null : { type: 'ChallengeGym', gymId: gym.id, unitIds: team }, ...(reason ? { reason: gymBlockerText(reason) } : {}) } }) });
  }
  const rivals = view.expansion?.rivals, pending = rivals?.pending;
  if (rivals && pending?.tileIndex === index) {
    const capital = view.economy.player.headquartersCityId === pending.cityId;
    entities.push({ kind: 'rival', tone: 'enemy', title: `⚠ 劲敌${rivals.name}将在第 ${pending.round} 轮出现`, subtitle: `目标：${capital ? '首都' : `城市 ${pending.cityId}`}（只有你看得到这条预告）`,
      lines: [`劲敌第 ${rivals.encounter + 1} 次登场，带着克制你御三家的宝可梦。它们只打你的宝可梦和城市（城市不会低于 1 HP），不打开拓队、工匠和商队，${RIVAL_RULES_V24.staysRounds} 轮后离开。`],
      hint: '在目标城市附近留几只宝可梦；全部击倒有奖励。' });
  }
  return entities;
}
/** Subtitle, extra line and hint for a rival trainer's Pokémon in the tile inspector (null for anyone else). */
export function rivalUnitNote(view: PlayerView, unitId: number): { subtitle: string; line: string; hint: string } | null {
  const sighting = viewRivalSighting(view, unitId);
  if (!sighting) return null;
  const mine = sighting.targetPlayerId === view.playerId;
  return { subtitle: `劲敌${sighting.name}的宝可梦 · 目标：${civ(view, sighting.targetPlayerId)}`, line: `劲敌气势 ${sighting.spirit >= 0 ? '+' : ''}${sighting.spirit}（攻防都算）`,
    hint: mine ? '击倒这次登场的全部劲敌宝可梦就能得到奖励；不能捕捉。' : '它只找它的目标文明。你可以攻击它，但没有奖励；不能捕捉。' };
}

// ---------- world panel card ----------

/** Badge box (8 slots: circuit badges, plus the essences of own city gyms), Elite Four button, rival card. */
export function v24PanelCards(view: PlayerView, button: (label: string, action: Command['action'], available?: boolean) => string,
  card: (id: string, title: string, body: string) => string): string {
  const content = contentForView(view), circuit = view.expansion?.gymCircuit, rivals = view.expansion?.rivals;
  let html = '';
  if (circuit) {
    const won = badgesOf(view), cityGyms = new Set((view.expansion?.essences?.gyms ?? []).filter(gym => view.economy.cities.some(city => city.id === gym.cityId)).map(gym => gym.essence));
    const slots = Array.from({ length: Math.max(GYM_RULES_V24.gymCount, won.length) }, (_, slot) => {
      const gym = circuit.gyms.find(item => item.id === won[slot]);
      return gym ? `<li class="badge-slot won" style="--badge:${ESSENCES[gym.essence].color}" title="${esc(gymTitle(gym))}">${uiIcon(`gym:${gym.typeId}`, { size: 30, label: `${TYPE_NAMES[gym.typeId]}属性徽章 · ${gymTitle(gym)}` })}<span>${esc(GYM_LEADERS[gym.leader].name)}</span></li>`
        : `<li class="badge-slot empty">${uiIcon('badge', { size: 30, label: `空徽章槽 ${slot + 1}` })}</li>`;
    }).join('');
    const own = view.units.filter((unit): unit is Extract<MapUnit, { kind: 'pokemon' }> => unit.ownerId === view.playerId && unit.kind === 'pokemon' && unit.actionLeft === 1)
      .sort((a, b) => unitPower(b, content) - unitPower(a, content) || a.id - b.id).slice(0, GYM_RULES_V24.eliteFour.team);
    const elite = viewEliteFourBlocker(view, own.map(unit => unit.id));
    const rows = circuit.gyms.map(gym => `<li class="${won.includes(gym.id) ? 'won' : ''}">${typeBadge(gym.typeId, 20)}<span>${esc(gymTitle(gym))}</span>${gym.homeOf === view.playerId ? '<small>家门口</small>' : ''}${won.includes(gym.id) ? uiIcon('check', { size: 14, label: '已获得徽章' }) : ''}</li>`).join('');
    const others = Object.entries(circuit.badges).filter(([id]) => Number(id) !== view.playerId).map(([id, list]) => `<span class="icon-stat" role="img" aria-label="${esc(`文明 ${Number(id) + 1} ${list.length} 枚${circuit.eliteFour[Number(id)]?.won ? '（已胜四天王）' : ''}`)}">文明 ${Number(id) + 1} ${uiIcon('badge', { size: 14 })}<b aria-hidden="true">${list.length}</b>${circuit.eliteFour[Number(id)]?.won ? uiIcon('trophy', { size: 14 }) : ''}</span>`).join('');
    html += card('s-gym-circuit', `道馆巡回 · 徽章 ${won.length}/${GYM_RULES_V24.gymCount}`,
      `<p>8 座中立道馆，谁都能带 1–3 只宝可梦挑战，各自赢得徽章。馆主强度随你已有的徽章数提高：你的下一位馆主 <b>${esc(nextLeaderText(view))}</b>。巡回徽章和自建属性道馆一样，能解锁对应属性的最终形态${cityGyms.size ? `（自建道馆：${[...cityGyms].map(id => ESSENCES[id].name).join('、')}）` : ''}。</p>`
      + `<ul class="badge-box" id="badge-box">${slots}</ul>`
      + `<p>已发现的道馆：</p><ul class="gym-list gym-list-icons">${rows || '<li>还没有发现道馆，派宝可梦去探索。</li>'}</ul>`
      + `<p class="world-stats">其他文明：${others || '无'}</p>`
      + `<p>集齐 ${GYM_RULES_V24.gymCount} 枚后挑战四天王（${ELITE_FOUR.map(member => member.name).join('、')}）：派 ${GYM_RULES_V24.eliteFour.team} 只宝可梦连战 5 场，赢了得 1 个冠军赛头衔（每局一次）、金币 ${GYM_RULES_V24.eliteFour.gold}。</p>`
      + (circuit.eliteFour[view.playerId]?.won ? '<p>你已战胜四天王，冠军赛头衔 +1。</p>'
        : button('挑战四天王', { type: 'ChallengeEliteFour', unitIds: own.map(unit => unit.id) }, elite === null) + (elite ? `<small class="gym-blocker">${esc(gymBlockerText(elite))}</small>` : '')));
  }
  if (rivals) {
    const status = rivals.pending ? `⚠ 第 ${rivals.pending.round} 轮登场，目标：${view.economy.player.headquartersCityId === rivals.pending.cityId ? '首都' : `城市 ${rivals.pending.cityId}`}`
      : rivals.activeUnitIds.length ? `正在你的领土附近（第 ${rivals.encounter} 次登场，还剩 ${rivals.activeUnitIds.length} 只）`
      : rivals.nextArrival !== null ? `下一次登场：第 ${rivals.nextArrival} 轮（提前 ${RIVAL_RULES_V24.warningRounds} 轮预告）` : '三次登场都已结束。';
    const outcomes = rivals.outcomes.map((outcome, index) => `第 ${index + 1} 次：${({ defeated: '击退', departed: '离开', skipped: '未登场' } as const)[outcome]}`).join(' · ');
    html += card('s-rivals', `你的劲敌：${rivals.name}`, `<p id="rival-status">${esc(status)}</p><p>劲敌在第 ${RIVAL_RULES_V24.arrivals.join(' / ')} 轮登场，带克制你御三家的宝可梦，强度跟着你第二强的宝可梦走（「劲敌气势」）。只打你的宝可梦和城市（城市不会低于 1 HP），${RIVAL_RULES_V24.staysRounds} 轮后离开；不能捕捉。全部击倒有奖励：${RIVAL_RULES_V24.rewards.map((reward, index) => `第 ${index + 1} 次 金币 ${reward.gold}`).join('、')}。</p>${outcomes ? `<p>${esc(outcomes)}</p>` : ''}`);
  }
  return html;
}

// ---------- unit bar action and floating preview card ----------

/** The 挑战道馆 bar action for an own Pokémon standing on a gym: its gym and why it cannot challenge (null = it can). */
export function gymBarState(view: PlayerView, unit: MapUnit): { gym: GymSite; team: number[]; reason: string | null } | null {
  if (unit.kind !== 'pokemon') return null;
  const gym = gymAt(view.expansion?.gymCircuit, hexToIndex(unit.position, view.map)!);
  if (!gym) return null;
  const team = viewGymTeam(view, gym.id, contentForView(view)), blocked = viewGymBlocker(view, gym.id, team);
  return { gym, team, reason: blocked ? gymBlockerText(blocked) : null };
}
type Opened = { unitId: number; confirm: (action: Command['action']) => void } | null;
let opened: Opened = null, host: HTMLElement | null = null, markup = '';
function ensureHost(): HTMLElement | null {
  if (host?.isConnected) return host;
  const frame = document.querySelector<HTMLElement>('.map-frame');
  if (!frame) return null;
  host = document.createElement('section');
  host.id = 'gym-card'; host.className = 'combat-card gym-card'; host.hidden = true;
  host.setAttribute('role', 'dialog'); host.setAttribute('aria-label', '道馆挑战预览');
  // Esc closes the card first (before the map's Esc clears the selection), wherever the focus is.
  window.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !opened || host?.hidden !== false) return;
    event.preventDefault(); event.stopImmediatePropagation(); closeGymCard();
  }, { capture: true });
  frame.append(host); markup = '';
  return host;
}
export function closeGymCard(): void {
  opened = null;
  if (host) { host.hidden = true; host.innerHTML = ''; markup = ''; }
}
/** Card body: the challenger team (left), the power comparison (centre), the leader team (right). */
export function gymCardMarkup(view: PlayerView, unitId: number): string | null {
  const unit = view.units.find(item => item.id === unitId && item.ownerId === view.playerId);
  const state = unit && gymBarState(view, unit);
  if (!state) return null;
  const content = contentForView(view), { gym, team, reason } = state, row = leaderTeamFor(badgesOf(view).length, content);
  const members = team.map(id => view.units.find(item => item.id === id)!).filter((item): item is Extract<MapUnit, { kind: 'pokemon' }> => item.kind === 'pokemon');
  const power = members.reduce((sum, item) => sum + unitPower(item, content), 0), ratio = Math.round(power * 100 / row.power);
  const side = members.map(item => `<div class="cp-who"><span class="cp-sprite"><img src="${pokemonSpritePath(item.speciesId)}" alt="" width="40" height="40"></span><p><strong>${esc(unitDefinition(item, content).name)}</strong><small>HP ${item.hp}/${content.species[item.speciesId].maxHp} · 战力 ${unitPower(item, content)}</small></p></div>`).join('');
  return `<header><p class="eyebrow">道馆挑战 · ${esc(gymTitle(gym))}</p><button type="button" class="cp-close" id="gym-card-close" aria-label="取消（Esc）" title="取消（Esc）">×</button></header>
    <div class="cp-columns"><div class="cp-side cp-attack" data-side="team">${side || '<p>没有可出战的宝可梦</p>'}<p class="cp-total">队伍战力<b id="gym-card-team">${power}</b></p></div>
    <div class="cp-centre"><b class="cp-gap ${ratio >= 125 ? 'pos' : ratio < 100 ? 'neg' : ''}" id="gym-card-ratio">${ratio}%</b><small>战力比<br>自动对战</small></div>
    <div class="cp-side cp-defense" data-side="leader"><div class="cp-who"><p><strong>${esc(GYM_LEADERS[gym.leader].name)}</strong><small>${TYPE_NAMES[gym.typeId]}属性 · ${row.members} 只${STAGE_NAMES[row.stage]}</small></p></div><p class="cp-total">馆主战力<b id="gym-card-leader">${row.power}</b></p></div></div>
    <div class="cp-result"><p>参战宝可梦花掉本回合行动，以当前 HP 出战，战后至少保留 1 HP。胜利：${ESSENCES[gym.essence].name}徽章（第 ${badgesOf(view).length + 1} 枚）、金币 ${GYM_RULES_V24.reward.goldPerBadge * (badgesOf(view).length + 1)}、${ESSENCES[gym.essence].name}精华 +${GYM_RULES_V24.reward.essence}、经验 +${GYM_RULES_V24.reward.xp}。</p>${reason ? `<p class="cp-reason">${esc(reason)}</p>` : ''}</div>
    <footer><small>Esc 取消</small><button type="button" class="primary" id="gym-card-challenge" ${reason ? 'disabled' : ''}>挑战</button></footer>`;
}
/** Opens the card for this unit (from the unit bar); `confirm` issues the command. */
export function openGymCard(view: PlayerView, unitId: number, confirm: (action: Command['action']) => void): void {
  opened = { unitId, confirm };
  refreshGymCard(view, unitId, false);
}
/** Re-renders the open card for the current view and selection; closes it when the selection moved on. */
export function refreshGymCard(view: PlayerView, selectedUnitId: number | null, disabled: boolean): void {
  if (!opened) return;
  if (opened.unitId !== selectedUnitId) { closeGymCard(); return; }
  const body = gymCardMarkup(view, opened.unitId), element = ensureHost();
  if (!body || !element) { closeGymCard(); return; }
  const html = disabled ? body.replace('id="gym-card-challenge" ', 'id="gym-card-challenge" disabled ') : body;
  if (html !== markup) {
    element.innerHTML = html; markup = html;
    const state = gymBarState(view, view.units.find(item => item.id === opened!.unitId)!)!;
    element.querySelector('#gym-card-close')?.addEventListener('click', closeGymCard);
    element.querySelector('#gym-card-challenge')?.addEventListener('click', () => {
      const confirm = opened?.confirm;
      closeGymCard();
      confirm?.({ type: 'ChallengeGym', gymId: state.gym.id, unitIds: state.team });
    });
  }
  element.hidden = false;
  const frame = element.parentElement!.getBoundingClientRect(), bar = document.querySelector<HTMLElement>('#unit-action-bar')?.getBoundingClientRect();
  const anchor = bar ? { x: bar.left - frame.left + bar.width / 2, y: bar.top - frame.top } : { x: frame.width / 2, y: frame.height / 2 };
  const spot = placeCard({ width: element.offsetWidth, height: element.offsetHeight }, anchor, { width: frame.width, height: frame.height }, [], 24);
  element.style.transform = `translate(${spot.left}px, ${spot.top}px)`;
}
/** Original lines of the rival for notifications. */
export const rivalSays = (encounter: number, moment: 'arrive' | 'leave' | 'beaten') => rivalLines(encounter)[moment];
