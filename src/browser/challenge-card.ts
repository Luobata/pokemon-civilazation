// depth-v26 §2.5 (presentation only): the preview card before a sanctuary guardian or Elite Four challenge (issued from
// the world panel): both teams' sprites, the power comparison and the type-matchup grid (matchup-grid.ts), then 挑战.
// After the command the card shows the result and opens the replay (battle-viewer.ts). It sits above the screens (the
// world panel is one), so it is a fixed dialog; on the map it is placed off the HUD like the other cards. PlayerView only.
import { guardianCombatant } from '../core/civilization-systems.ts';
import { CIVILIZATION_CONTENT } from '../content/civilization-systems.ts';
import { eliteFourTeam, unitPower } from '../core/gym-circuit.ts';
import { ELITE_FOUR } from '../content/gym-circuit.ts';
import { contentForView } from '../content/units.ts';
import { TYPE_NAMES } from '../content/type-names.ts';
import type { Command, MapUnit, PlayerView } from '../core/model.ts';
import type { BattleCombatant } from '../core/civilization-systems.ts';
import { matchupGridMarkup } from './matchup-grid.ts';
import { speciesTypes } from './gym-panel.ts';
import { pokemonSpritePath } from './sprites.ts';
import { artImage, escapeAttr, uiIcon } from './ui-icons.ts';

export type PreviewedChallenge = Extract<Command['action'], { type: 'ChallengeGuardian' | 'ChallengeEliteFour' }>;
export const isPreviewedChallenge = (action: Command['action']): action is PreviewedChallenge => action.type === 'ChallengeGuardian' || action.type === 'ChallengeEliteFour';

type Opened = { action: PreviewedChallenge; confirm: (action: Command['action']) => void; stage: number; issued: boolean; result: { key: string; victory: boolean; text: string } | null; watch: (key: string) => void };
let opened: Opened | null = null, host: HTMLElement | null = null;

const combatantPower = (combatant: BattleCombatant) => combatant.maxHp + combatant.attack + combatant.defense;
function opponents(view: PlayerView, action: PreviewedChallenge, stage: number): { name: string; team: BattleCombatant[]; power: number; note: string } | null {
  const content = contentForView(view);
  if (action.type === 'ChallengeGuardian') {
    const site = view.expansion?.civilization?.sanctuaries.find(item => item.id === action.siteId);
    if (!site) return null;
    const guardian = guardianCombatant(site, { ...CIVILIZATION_CONTENT, world: content });
    return { name: `守卫${site.guardianName}`, team: [guardian], power: site.challengePower, note: `${site.name} · 胜利得到石板「${site.tabletName}」` };
  }
  const member = ELITE_FOUR[stage]!, team = eliteFourTeam(stage, view.seed, content);
  return { name: `${member.title}${member.name}`, team, power: team.reduce((sum, item) => sum + combatantPower(item), 0), note: `连战 ${ELITE_FOUR.length} 场，场间恢复已损失 HP 的一半` };
}
function markup(view: PlayerView, state: Opened): string | null {
  const content = contentForView(view), foe = opponents(view, state.action, state.stage);
  if (!foe) return null;
  const team = state.action.unitIds.map(id => view.units.find((unit): unit is Extract<MapUnit, { kind: 'pokemon' }> => unit.id === id && unit.kind === 'pokemon')).filter(Boolean) as Extract<MapUnit, { kind: 'pokemon' }>[];
  const power = team.reduce((sum, unit) => sum + unitPower(unit, content), 0), ratio = Math.round(power * 100 / Math.max(1, foe.power));
  const title = state.action.type === 'ChallengeGuardian' ? '圣所守卫挑战' : '四天王与冠军';
  const mine = team.map(unit => `<div class="cp-who"><span class="cp-sprite"><img src="${pokemonSpritePath(unit.speciesId)}" alt="" width="40" height="40"></span><p><strong>${escapeAttr(content.species[unit.speciesId].name)}</strong><small>HP ${unit.hp}/${content.species[unit.speciesId].maxHp} · 战力 ${unitPower(unit, content)}</small></p></div>`).join('');
  const theirs = foe.team.map(item => artImage(pokemonSpritePath(item.speciesId), { size: 32, label: `${content.species[item.speciesId].name}（${item.typeIds.map(type => TYPE_NAMES[type]).join(' / ')}）` })).join('');
  const stages = state.action.type === 'ChallengeEliteFour' ? `<nav class="cc-stages" aria-label="五场对手">${ELITE_FOUR.map((member, index) => `<button type="button" data-cc-stage="${index}" aria-pressed="${index === state.stage}" title="第 ${index + 1} 场：${member.title}${member.name}">${uiIcon(index === ELITE_FOUR.length - 1 ? 'crown' : 'trainer', { size: 14 })}${escapeAttr(member.name)}</button>`).join('')}</nav>` : '';
  const grid = matchupGridMarkup(team.map(unit => ({ speciesId: unit.speciesId, typeIds: speciesTypes(content, unit.speciesId) })), foe.team, `属性克制：你的队伍对${foe.name}`, 'challenge-matchup');
  const result = state.result ? `<p class="cc-outcome ${state.result.victory ? 'won' : 'lost'}" id="challenge-card-outcome">${uiIcon(state.result.victory ? 'trophy' : 'damaged', { size: 18 })}${escapeAttr(state.result.text)}</p>` : '';
  const footer = state.result
    ? `<button type="button" class="primary replay-button" id="challenge-card-watch">${uiIcon('play', { size: 12 })}观看对战</button>`
    : `<button type="button" class="primary" id="challenge-card-confirm" ${state.issued ? 'disabled' : ''}>挑战</button>`;
  return `<header><p class="eyebrow">${title} · ${escapeAttr(foe.name)}</p><button type="button" class="cp-close" id="challenge-card-close" aria-label="关闭（Esc）" title="关闭（Esc）">×</button></header>${stages}
    <div class="cp-columns"><div class="cp-side cp-attack">${mine || '<p>没有可出战的宝可梦</p>'}<p class="cp-total">队伍战力<b id="challenge-card-team">${power}</b></p></div>
    <div class="cp-centre"><b class="cp-gap ${ratio >= 125 ? 'pos' : ratio < 100 ? 'neg' : ''}" id="challenge-card-ratio">${ratio}%</b><small>战力比<br>自动对战</small></div>
    <div class="cp-side cp-defense"><div class="cp-who"><p><strong>${escapeAttr(foe.name)}</strong><small>${escapeAttr(foe.note)}</small></p></div><p class="cp-team-sprites">${theirs}</p><p class="cp-total">对手战力<b id="challenge-card-foe">${foe.power}</b></p></div></div>
    ${grid}${result}<footer><small>Esc 关闭</small>${footer}</footer>`;
}
function ensureHost(): HTMLElement {
  if (host?.isConnected) return host;
  host = document.createElement('section');
  host.id = 'challenge-card'; host.className = 'combat-card gym-card challenge-card'; host.hidden = true;
  host.setAttribute('role', 'dialog'); host.setAttribute('aria-label', '挑战预览');
  window.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !opened || host?.hidden !== false || document.querySelector('#battle-viewer')) return;
    event.preventDefault(); event.stopImmediatePropagation(); closeChallengeCard();
  }, { capture: true });
  document.body.append(host);
  return host;
}
export function closeChallengeCard(): void {
  opened = null;
  if (host) { host.hidden = true; host.innerHTML = ''; }
}
function render(view: PlayerView): void {
  const state = opened, element = ensureHost();
  if (!state) return;
  const html = markup(view, state);
  if (!html) { closeChallengeCard(); return; }
  element.innerHTML = html; element.hidden = false;
  element.dataset.kind = state.action.type;
  element.querySelector('#challenge-card-close')!.addEventListener('click', closeChallengeCard);
  element.querySelector('#challenge-card-confirm')?.addEventListener('click', () => { state.issued = true; render(view); state.confirm(state.action); });
  element.querySelector('#challenge-card-watch')?.addEventListener('click', () => state.result && state.watch(state.result.key));
  for (const button of element.querySelectorAll<HTMLButtonElement>('[data-cc-stage]')) button.addEventListener('click', () => { state.stage = Number(button.dataset.ccStage); render(view); });
  (element.querySelector<HTMLButtonElement>('#challenge-card-watch') ?? element.querySelector<HTMLButtonElement>('#challenge-card-confirm'))?.focus({ preventScroll: true });
}
/** Opens the card for a guardian / Elite Four command the world panel was about to issue; `confirm` issues it. */
export function openChallengeCard(view: PlayerView, action: PreviewedChallenge, confirm: (action: Command['action']) => void, watch: (key: string) => void): void {
  opened = { action, confirm, stage: 0, issued: false, result: null, watch };
  render(view);
}
/** The command was refused (the card stays usable) or the result arrived (the card offers the replay). */
export function challengeCardResult(view: PlayerView, result: { key: string | null; victory: boolean; text: string } | null): void {
  if (!opened?.issued) return;
  if (!result) { opened.issued = false; render(view); return; }
  opened.result = result.key ? { key: result.key, victory: result.victory, text: result.text } : null;
  if (!result.key) { closeChallengeCard(); return; }
  render(view);
}
export const challengeCardOpen = () => opened !== null;
