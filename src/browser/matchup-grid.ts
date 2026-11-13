// depth-v26 §2.5 (presentation only): the type-matchup grid of a challenge card. One cell per pair "your Pokémon i ×
// opponent j": the upper-left arrow is your hit on it, the lower-right arrow its hit on you. The multiplier is the one the
// v24 auto-battle uses — the attacker's primary type against both defending types, with type research (×2.2) —
// read from the shared type chart (`dualEffectiveness`), so the grid never disagrees with the battle. Gameplay v26 relay
// battles (`relay: true`, the lineup picker): each side's best type against that opponent (`bestAttack`, a taught TM type
// included) and ▲ when your Pokémon strikes first (speed class, then attack + 历练) — again the battle's own rule.
import { dualEffectiveness } from '../core/combat-math.ts';
import { bestAttack } from '../core/team-battle.ts';
import { speciesDisplay } from '../content/species.ts';
import type { SpeciesId, TypeId } from '../content/species.ts';
import { TYPE_NAMES } from '../content/type-names.ts';
import { EFFECT_TEXT, effectTone, multiplierText } from './battle-replay.ts';
import type { EffectTone } from './battle-replay.ts';
import { pokemonSpritePath } from './sprites.ts';
import { artImage, escapeAttr, typeBadge, uiIcon } from './ui-icons.ts';
import '../battle-viewer.css';
import type { UiIconName } from './ui-icons.ts';

/** `speed` / `attack` / `veteran`: relay fighters only (who strikes first). */
export type MatchupMember = { speciesId: SpeciesId; typeIds: readonly TypeId[]; speed?: number; attack?: number; veteran?: number };
/** The auto-battle's multiplier (percent) of `attacker` hitting `defender`. */
export const battleMultiplier = (attacker: MatchupMember, defender: MatchupMember) => dualEffectiveness(attacker.typeIds[0]!, defender.typeIds, true);
/** v26 relay: the attacker's best type against this defender and its multiplier (the relay battle's rule). */
const relayMultiplier = (attacker: MatchupMember, defender: MatchupMember) => bestAttack({ typeIds: [...attacker.typeIds] }, { typeIds: [...defender.typeIds] });
const strikesFirst = (mine: MatchupMember, theirs: MatchupMember) => (mine.speed ?? 0) !== (theirs.speed ?? 0) ? (mine.speed ?? 0) > (theirs.speed ?? 0)
  : (mine.attack ?? 0) + (mine.veteran ?? 0) >= (theirs.attack ?? 0) + (theirs.veteran ?? 0);
const TONE_ICON: Record<EffectTone, UiIconName> = { super: 'matchupUp', weak: 'matchupDown', none: 'matchupNone', normal: 'matchupEven' };
const TONE_NAME: Record<EffectTone, string> = { super: '效果拔群', weak: '效果不太好', none: '没有效果', normal: '效果普通' };
const name = (member: MatchupMember) => speciesDisplay(member.speciesId).name;
const head = (member: MatchupMember, mirror: boolean) => `${artImage(pokemonSpritePath(member.speciesId), { size: 44, label: `${name(member)}（${member.typeIds.map(type => TYPE_NAMES[type]).join(' / ')}）`, className: mirror ? 'bv-mirror' : '' })}<span class="mu-types">${member.typeIds.map(type => typeBadge(type, 12)).join('')}</span>`;

/** The grid (rows: your team; columns: the opponent's), with a one-line icon legend. `relay`: the v26 relay rule (best type, ▲ first strike). */
export function matchupGridMarkup(home: readonly MatchupMember[], away: readonly MatchupMember[], caption: string, id = 'matchup-grid', relay = false): string {
  if (!home.length || !away.length) return '';
  const rows = home.map((mine, row) => `<tr><th scope="row">${head(mine, true)}</th>${away.map((theirs, column) => {
    const mineHit = relay ? relayMultiplier(mine, theirs) : null, theirHit = relay ? relayMultiplier(theirs, mine) : null;
    const out = mineHit?.effectiveness ?? battleMultiplier(mine, theirs), into = theirHit?.effectiveness ?? battleMultiplier(theirs, mine), outTone = effectTone(out), inTone = effectTone(into);
    const edge = out > into ? 'good' : out < into ? 'bad' : 'even', first = relay && strikesFirst(mine, theirs);
    const label = `${name(mine)} 对 ${name(theirs)}：你的攻击${mineHit ? `（${TYPE_NAMES[mineHit.typeId]}）` : ''} ${multiplierText(out)} ${TONE_NAME[outTone]}；对手的攻击${theirHit ? `（${TYPE_NAMES[theirHit.typeId]}）` : ''} ${multiplierText(into)} ${TONE_NAME[inTone]}${relay ? `；${first ? '你先手' : '它先手'}` : ''}`;
    return `<td class="mu-cell ${edge}" data-row="${row}" data-column="${column}" data-out="${out}" data-in="${into}"${relay ? ` data-first="${first}"` : ''} role="img" aria-label="${escapeAttr(label)}" title="${escapeAttr(label)}">`
      + `<span class="mu-out">${uiIcon(TONE_ICON[outTone], { size: 14 })}</span><span class="mu-in">${uiIcon(TONE_ICON[inTone], { size: 11 })}</span>${first ? '<span class="mu-first" aria-hidden="true">▲</span>' : ''}</td>`;
  }).join('')}</tr>`).join('');
  const legend = (['super', 'weak', 'none'] as const).map(tone => `<span>${uiIcon(TONE_ICON[tone], { size: 12 })}${EFFECT_TEXT[tone].replace(/[！…]+$/, '')}</span>`).join('')
    + (relay ? '<span class="mu-key"><span class="mu-first-key" aria-hidden="true">▲</span>你先手</span>' : '');
  return `<div class="matchup" id="${id}"><table class="matchup-grid" aria-label="${escapeAttr(caption)}">
    <thead><tr><th scope="col"><span class="visually-hidden">你的宝可梦 对 对手</span>${uiIcon('swords', { size: 16 })}</th>${away.map(theirs => `<th scope="col">${head(theirs, false)}</th>`).join('')}</tr></thead>
    <tbody>${rows}</tbody></table>
    <p class="matchup-legend">${legend}<span class="mu-key"><span class="mu-out">${uiIcon('matchupUp', { size: 12 })}</span>你打它 · <span class="mu-in">${uiIcon('matchupDown', { size: 10 })}</span>它打你</span></p></div>`;
}
