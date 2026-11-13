// depth-v26 §2.5 (presentation only): the type-matchup grid of a challenge card. One cell per pair "your Pokémon i ×
// opponent j": the upper-left arrow is your hit on it, the lower-right arrow its hit on you. The multiplier is the one the
// v24 auto-battle uses — the attacker's primary type against both defending types, with type research (×2.2) —
// read from the shared type chart (`dualEffectiveness`), so the grid never disagrees with the battle.
import { dualEffectiveness } from '../core/combat-math.ts';
import { speciesDisplay } from '../content/species.ts';
import type { SpeciesId, TypeId } from '../content/species.ts';
import { TYPE_NAMES } from '../content/type-names.ts';
import { EFFECT_TEXT, effectTone, multiplierText } from './battle-replay.ts';
import type { EffectTone } from './battle-replay.ts';
import { pokemonSpritePath } from './sprites.ts';
import { artImage, escapeAttr, typeBadge, uiIcon } from './ui-icons.ts';
import '../battle-viewer.css';
import type { UiIconName } from './ui-icons.ts';

export type MatchupMember = { speciesId: SpeciesId; typeIds: readonly TypeId[] };
/** The auto-battle's multiplier (percent) of `attacker` hitting `defender`. */
export const battleMultiplier = (attacker: MatchupMember, defender: MatchupMember) => dualEffectiveness(attacker.typeIds[0]!, defender.typeIds, true);
const TONE_ICON: Record<EffectTone, UiIconName> = { super: 'matchupUp', weak: 'matchupDown', none: 'matchupNone', normal: 'matchupEven' };
const TONE_NAME: Record<EffectTone, string> = { super: '效果拔群', weak: '效果不太好', none: '没有效果', normal: '效果普通' };
const name = (member: MatchupMember) => speciesDisplay(member.speciesId).name;
const head = (member: MatchupMember, mirror: boolean) => `${artImage(pokemonSpritePath(member.speciesId), { size: 44, label: `${name(member)}（${member.typeIds.map(type => TYPE_NAMES[type]).join(' / ')}）`, className: mirror ? 'bv-mirror' : '' })}<span class="mu-types">${member.typeIds.map(type => typeBadge(type, 12)).join('')}</span>`;

/** The grid (rows: your team; columns: the opponent's), with a one-line icon legend. */
export function matchupGridMarkup(home: readonly MatchupMember[], away: readonly MatchupMember[], caption: string, id = 'matchup-grid'): string {
  if (!home.length || !away.length) return '';
  const rows = home.map((mine, row) => `<tr><th scope="row">${head(mine, true)}</th>${away.map((theirs, column) => {
    const out = battleMultiplier(mine, theirs), into = battleMultiplier(theirs, mine), outTone = effectTone(out), inTone = effectTone(into);
    const edge = out > into ? 'good' : out < into ? 'bad' : 'even';
    const label = `${name(mine)} 对 ${name(theirs)}：你的攻击 ${multiplierText(out)} ${TONE_NAME[outTone]}；对手的攻击 ${multiplierText(into)} ${TONE_NAME[inTone]}`;
    return `<td class="mu-cell ${edge}" data-row="${row}" data-column="${column}" data-out="${out}" data-in="${into}" role="img" aria-label="${escapeAttr(label)}" title="${escapeAttr(label)}">`
      + `<span class="mu-out">${uiIcon(TONE_ICON[outTone], { size: 14 })}</span><span class="mu-in">${uiIcon(TONE_ICON[inTone], { size: 11 })}</span></td>`;
  }).join('')}</tr>`).join('');
  const legend = (['super', 'weak', 'none'] as const).map(tone => `<span>${uiIcon(TONE_ICON[tone], { size: 12 })}${EFFECT_TEXT[tone].replace(/[！…]+$/, '')}</span>`).join('');
  return `<div class="matchup" id="${id}"><table class="matchup-grid" aria-label="${escapeAttr(caption)}">
    <thead><tr><th scope="col"><span class="visually-hidden">你的宝可梦 对 对手</span>${uiIcon('swords', { size: 16 })}</th>${away.map(theirs => `<th scope="col">${head(theirs, false)}</th>`).join('')}</tr></thead>
    <tbody>${rows}</tbody></table>
    <p class="matchup-legend">${legend}<span class="mu-key"><span class="mu-out">${uiIcon('matchupUp', { size: 12 })}</span>你打它 · <span class="mu-in">${uiIcon('matchupDown', { size: 10 })}</span>它打你</span></p></div>`;
}
