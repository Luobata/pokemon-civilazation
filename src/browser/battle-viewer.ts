// depth-v26 §2.5 (presentation only): the battle replay viewer. A Pokémon-style stage (original pixel arenas,
// battle-arena.ts) on a canvas: both teams sent out from Poké Balls, every recorded strike played in order — lunge or a
// type-coloured shot, a white hit flash with pooled type-coloured particles, the HP bar draining, 效果拔群 / 效果不太好
// captions, fainting (sink, grey, fade), the Elite Four's next opponent switched in. Play / pause, step, ×1 / ×2 / ×4 and
// skip; every strike is also a line of the step list (the accessible record). Under reduced motion the stage is drawn
// still and the step list is the view. Reads a BattleReplay only (battle-replay.ts); never touches the game.
import { TYPE_COLORS } from '../content/type-colors.ts';
import { TYPE_NAMES } from '../content/type-names.ts';
import { speciesDisplay } from '../content/species.ts';
import { ARENA_HEIGHT, ARENA_NAMES, ARENA_WIDTH, PLATFORMS, arenaCanvas } from './battle-arena.ts';
import { EFFECT_TEXT, effectTone, multiplierText } from './battle-replay.ts';
import type { BattleReplay, ReplayBattle, ReplayFighter, ReplaySide, ReplayStrike } from './battle-replay.ts';
import { drawPokemonSilhouette, drawPokemonSprite, pokemonSpritePath } from './sprites.ts';
import { artImage, escapeAttr, iconUrl, uiIcon } from './ui-icons.ts';
import type { UiIconName } from './ui-icons.ts';
import { placeCard } from './combat-preview.ts';
import { attackSound } from './audio/sfx.ts';
import type { SoundId } from './audio/sfx.ts';
import '../battle-viewer.css';

// ---------- timeline ----------

type Beat = { kind: 'intro'; battle: number } | { kind: 'strike'; battle: number; strike: number } | { kind: 'outro'; battle: number } | { kind: 'result' };
const INTRO_MS = 1000, STRIKE_MS = 1050, FAINT_MS = 450, OUTRO_MS = 800, RESULT_MS = 1400;
const LUNGE_AT = 120, MELEE_IMPACT = 340, RANGED_IMPACT = 420;
const beatDuration = (replay: BattleReplay, beat: Beat) => beat.kind === 'intro' ? INTRO_MS + replay.battles[beat.battle]!.home.length * 40
  : beat.kind === 'strike' ? STRIKE_MS + (replay.battles[beat.battle]!.strikes[beat.strike]!.fainted ? FAINT_MS : 0) : beat.kind === 'outro' ? OUTRO_MS : RESULT_MS;
const impactAt = (attacker: ReplayFighter) => attacker.ranged ? RANGED_IMPACT : MELEE_IMPACT;
type Plan = { beats: Beat[]; starts: number[]; total: number;
  /** HP of every fighter (by battle-qualified id) at each beat's start. */
  hp: Map<string, number>[] };
const qid = (battle: number, id: string) => `${battle}:${id}`;
export function planReplay(replay: BattleReplay): Plan {
  const beats: Beat[] = [];
  replay.battles.forEach((battle, index) => {
    beats.push({ kind: 'intro', battle: index });
    battle.strikes.forEach((_, strike) => beats.push({ kind: 'strike', battle: index, strike }));
    beats.push({ kind: 'outro', battle: index });
  });
  beats.push({ kind: 'result' });
  const starts: number[] = [], hp: Map<string, number>[] = [];
  let at = 0;
  const current = new Map<string, number>();
  for (const [index, battle] of replay.battles.entries()) for (const item of [...battle.home, ...battle.away]) current.set(qid(index, item.id), item.hp);
  for (const beat of beats) {
    starts.push(at); hp.push(new Map(current));
    at += beatDuration(replay, beat);
    if (beat.kind === 'strike') { const strike = replay.battles[beat.battle]!.strikes[beat.strike]!; current.set(qid(beat.battle, strike.defenderId), strike.hpAfter); }
  }
  return { beats, starts, total: at, hp };
}

// ---------- drawing helpers ----------

const SIZE = [0, 52, 42, 36, 31, 28, 25];
type Slot = { x: number; feet: number; size: number };
function slots(side: ReplaySide, count: number): Slot[] {
  const platform = PLATFORMS[side], base = SIZE[Math.min(6, Math.max(1, count))]!, size = Math.round(base * (side === 'away' ? .82 : 1));
  const spacing = Math.min(size * .82, (platform.rx * 2 - size * .3) / Math.max(1, count - 1 || 1));
  return Array.from({ length: count }, (_, index) => ({ x: Math.round(platform.x + (index - (count - 1) / 2) * spacing), feet: platform.y + (index % 2 ? -3 : 1), size }));
}
const hpColor = (hp: number, max: number) => hp * 2 > max ? '#58C878' : hp * 5 > max ? '#F2C14E' : '#E5554A';
const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.max(0, Math.min(1, t));
const easeOut = (t: number) => 1 - (1 - Math.max(0, Math.min(1, t))) ** 2;
const nameOf = (fighter: ReplayFighter) => `${fighter.side === 'away' ? '对手的' : ''}${speciesDisplay(fighter.speciesId).name}`;

/** Pooled square particles (fixed array, fillRect only; no allocation per frame). */
const POOL = Array.from({ length: 48 }, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 1, color: '#FFFFFF' }));
function burst(x: number, y: number, color: string, count: number) {
  let spawned = 0;
  for (const particle of POOL) {
    if (spawned >= count) break;
    if (particle.life > 0) continue;
    const angle = spawned * 2.39996 + x * .01, speed = 30 + (spawned * 37 % 11) * 5;
    Object.assign(particle, { x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 18, life: 420 + (spawned % 4) * 60, max: 420 + (spawned % 4) * 60,
      size: 1 + spawned % 3, color: spawned % 4 === 0 ? '#FFFDF7' : color });
    spawned++;
  }
}
function stepParticles(context: CanvasRenderingContext2D, dt: number): boolean {
  let alive = false;
  for (const particle of POOL) {
    if (particle.life <= 0) continue;
    particle.life -= dt; particle.x += particle.vx * dt / 1000; particle.y += particle.vy * dt / 1000; particle.vy += 60 * dt / 1000;
    if (particle.life <= 0) continue;
    alive = true;
    context.globalAlpha = Math.min(1, particle.life / particle.max * 1.6);
    context.fillStyle = particle.color; context.fillRect(Math.round(particle.x), Math.round(particle.y), particle.size, particle.size);
  }
  context.globalAlpha = 1;
  return alive;
}
const clearParticles = () => { for (const particle of POOL) particle.life = 0; };
function outlined(context: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'center') {
  context.font = `800 ${size}px system-ui, sans-serif`; context.textAlign = align; context.textBaseline = 'middle'; context.lineJoin = 'round';
  context.lineWidth = Math.max(1.5, size * .22); context.strokeStyle = '#10191B'; context.strokeText(text, x, y);
  context.fillStyle = color; context.fillText(text, x, y);
}
function ball(context: CanvasRenderingContext2D, x: number, y: number, alive = true) {
  const cx = Math.round(x), cy = Math.round(y);
  context.fillStyle = '#10191B'; context.fillRect(cx - 2, cy - 3, 5, 7); context.fillRect(cx - 3, cy - 2, 7, 5);
  context.fillStyle = alive ? '#E0483A' : '#6F7B75'; context.fillRect(cx - 2, cy - 2, 5, 2);
  context.fillStyle = alive ? '#FFF8E5' : '#9AA6A0'; context.fillRect(cx - 2, cy + 1, 5, 2);
  context.fillStyle = '#10191B'; context.fillRect(cx - 2, cy, 5, 1);
  context.fillStyle = '#FFF8E5'; context.fillRect(cx, cy, 1, 1);
}
/** A fighter's sprite (mirrored on the viewer's side, which only has front sprites), optionally as a one-colour silhouette. */
function sprite(context: CanvasRenderingContext2D, fighter: ReplayFighter, x: number, feet: number, size: number, options: { alpha?: number; tint?: string; tintAlpha?: number; sink?: number } = {}) {
  const top = feet - size * .9;
  context.save();
  if (options.sink) { context.beginPath(); context.rect(x - size, 0, size * 2, feet + 1); context.clip(); }
  context.globalAlpha = options.alpha ?? 1;
  context.translate(x, top + (options.sink ?? 0));
  if (fighter.side === 'home') context.scale(-1, 1);
  if (!drawPokemonSprite(context, fighter.speciesId, -size / 2, 0, size)) {
    context.fillStyle = TYPE_COLORS[fighter.typeIds[0]!] ?? '#9AA6A0'; context.fillRect(-size * .3, size * .3, size * .6, size * .6);
  }
  if (options.tint && options.tintAlpha) { context.globalAlpha = (options.alpha ?? 1) * options.tintAlpha; drawPokemonSilhouette(context, fighter.speciesId, -size / 2, 0, size, options.tint); }
  context.restore();
}

// ---------- the viewer ----------

type Viewer = {
  root: HTMLElement; canvas: HTMLCanvasElement; context: CanvasRenderingContext2D; caption: HTMLElement; steps: HTMLOListElement;
  replay: BattleReplay; plan: Plan; time: number; playing: boolean; speed: 1 | 2 | 4; motion: boolean; scale: number;
  last: number | null; frame: number | null; beat: number; captionText: string; play: (id: SoundId) => void; onClose?: () => void;
  /** One-off bursts already fired since the last seek (hit sparks, send-out flashes). */
  fired: Set<string>;
};
let viewer: Viewer | null = null;
const resultIcons = new Map<UiIconName, HTMLImageElement>();
function iconImage(name: UiIconName): HTMLImageElement {
  let image = resultIcons.get(name);
  if (!image) { image = new Image(); image.src = iconUrl(name); image.onload = () => viewer && draw(viewer, 0); resultIcons.set(name, image); }
  return image;
}

const beatAt = (plan: Plan, time: number) => {
  let index = 0;
  while (index + 1 < plan.beats.length && plan.starts[index + 1]! <= time) index++;
  return index;
};
function draw(state: Viewer, dt: number): boolean {
  const { context, plan, replay } = state, index = beatAt(plan, state.time), beat = plan.beats[index]!, local = state.time - plan.starts[index]!;
  const battleIndex = beat.kind === 'result' ? replay.battles.length - 1 : beat.battle, battle = replay.battles[battleIndex]!;
  const hpStart = plan.hp[index]!;
  const strike: ReplayStrike | null = beat.kind === 'strike' ? battle.strikes[beat.strike]! : null;
  const fighters = [...battle.home, ...battle.away], byId = new Map(fighters.map(item => [item.id, item]));
  const attacker = strike ? byId.get(strike.attackerId)! : null, defender = strike ? byId.get(strike.defenderId)! : null;
  const impact = attacker ? impactAt(attacker) : 0;
  let shake = 0;
  if (strike && state.motion && local >= impact && local < impact + 140) shake = (Math.floor(local / 35) % 2 ? 1 : -1) * (effectTone(strike.effectiveness) === 'super' ? 2 : 1);
  const scale = state.scale * (window.devicePixelRatio || 1);
  context.setTransform(scale, 0, 0, scale, shake * scale, 0);
  context.imageSmoothingEnabled = false;
  context.drawImage(arenaCanvas(battle.arena), 0, 0);
  const positions = new Map<string, Slot>();
  for (const side of ['away', 'home'] as const) {
    const team = side === 'home' ? battle.home : battle.away;
    slots(side, team.length).forEach((slot, order) => positions.set(team[order]!.id, slot));
  }
  const hpOf = (fighter: ReplayFighter) => {
    const start = hpStart.get(qid(battleIndex, fighter.id)) ?? fighter.hp;
    if (strike && fighter.id === strike.defenderId && state.motion) return Math.round(lerp(start, strike.hpAfter, easeOut((local - impact) / 380)));
    if (strike && fighter.id === strike.defenderId) return strike.hpAfter;
    if (beat.kind === 'intro' && battle.healed && fighter.side === 'home' && state.motion) {
      const before = battleIndex > 0 ? plan.hp[index - 1]?.get(qid(battleIndex - 1, fighter.id)) : undefined;
      return before === undefined ? start : Math.round(lerp(before, start, easeOut((local - 300) / 500)));
    }
    return start;
  };
  // Sprites, back row first (the far side, then the near side).
  for (const fighter of [...battle.away, ...battle.home]) {
    const slot = positions.get(fighter.id)!, hp = hpOf(fighter), startHp = hpStart.get(qid(battleIndex, fighter.id)) ?? fighter.hp;
    let x = slot.x, feet = slot.feet, alpha = 1, tint: string | undefined, tintAlpha = 0, sink = 0, size = slot.size;
    const persistent = beat.kind === 'intro' && fighter.side === 'home' && battleIndex > 0;
    if (beat.kind === 'intro' && startHp > 0 && !persistent && state.motion) {
      const order = (fighter.side === 'home' ? battle.home : battle.away).indexOf(fighter), at = local - order * 90 - (fighter.side === 'home' ? 260 : 0);
      if (at < 380) {
        // The Poké Ball arcs in from the side's corner.
        const from = fighter.side === 'home' ? { x: -8, y: 120 } : { x: ARENA_WIDTH + 8, y: 12 }, t = Math.max(0, at) / 380;
        if (at > 0) ball(context, lerp(from.x, slot.x, t), lerp(from.y, slot.feet - 10, t) - Math.sin(t * Math.PI) * 26);
        continue;
      }
      const grow = easeOut((at - 380) / 240);
      if (!state.fired.has(`out:${index}:${fighter.id}`)) { state.fired.add(`out:${index}:${fighter.id}`); burst(slot.x, slot.feet - slot.size * .45, '#FFFDF7', 6); }
      size = Math.max(4, Math.round(slot.size * (.25 + .75 * grow))); tint = '#FFFFFF'; tintAlpha = 1 - grow;
    }
    if (startHp <= 0 && !(strike && fighter.id === strike.defenderId)) continue; // fainted earlier: back in its ball
    if (strike && state.motion) {
      if (fighter.id === strike.attackerId && !fighter.ranged) {
        const target = positions.get(strike.defenderId)!, reach = local < MELEE_IMPACT ? easeOut((local - LUNGE_AT) / (MELEE_IMPACT - LUNGE_AT)) : 1 - easeOut((local - MELEE_IMPACT) / 180);
        x = Math.round(lerp(slot.x, target.x, reach * .55)); feet = Math.round(lerp(slot.feet, target.feet, reach * .55));
      } else if (fighter.id === strike.attackerId && local < LUNGE_AT) feet -= Math.round(Math.sin(local / LUNGE_AT * Math.PI) * 3);
      if (fighter.id === strike.defenderId && local >= impact && local < impact + 300 && Math.floor((local - impact) / 50) % 2 === 0) { tint = '#FFFFFF'; tintAlpha = .85; }
      if (fighter.id === strike.defenderId && strike.fainted && local > impact + 520) {
        const t = (local - impact - 520) / 400;
        sink = Math.round(easeOut(t) * size * .9); alpha = 1 - t * .7; tint = '#6F7B75'; tintAlpha = Math.min(.7, t);
        if (t >= 1) continue;
      }
    } else if (strike && fighter.id === strike.defenderId && strike.fainted) continue;
    if (beat.kind === 'outro' && state.motion) {
      const won = fighter.side === battle.winner;
      if (won) feet -= Math.round(Math.abs(Math.sin(local / 160 * Math.PI)) * 3 * (local < 640 ? 1 : 0));
      else if (hp > 0) {
        // The beaten side's remaining Pokémon are recalled: a red silhouette shrinking into its ball.
        const t = easeOut(local / 500); tint = '#E5554A'; tintAlpha = Math.min(1, t * 2); size = Math.max(2, Math.round(slot.size * (1 - t)));
        if (t >= 1) continue;
      }
    } else if (beat.kind === 'result' && fighter.side !== battle.winner && hp > 0) continue;
    sprite(context, fighter, x, feet, size, { alpha, tint, tintAlpha, sink });
    if (size === slot.size && !sink) {
      // A compact HP bar above every Pokémon on the field.
      const width = Math.round(slot.size * .7), left = Math.round(slot.x - width / 2), top = Math.round(slot.feet - slot.size * .92 - 5);
      context.fillStyle = '#10191B'; context.fillRect(left - 1, top - 1, width + 2, 4);
      context.fillStyle = '#3A2A28'; context.fillRect(left, top, width, 2);
      context.fillStyle = hpColor(hp, fighter.maxHp); context.fillRect(left, top, Math.max(hp > 0 ? 1 : 0, Math.round(width * hp / fighter.maxHp)), 2);
    }
  }
  if (strike && attacker && defender && state.motion) {
    const from = positions.get(attacker.id)!, to = positions.get(defender.id)!, color = TYPE_COLORS[strike.typeId] ?? '#FFFDF7';
    const fromPoint = { x: from.x, y: from.feet - from.size * .5 }, toPoint = { x: to.x, y: to.feet - to.size * .45 };
    if (attacker.ranged && local >= LUNGE_AT && local < RANGED_IMPACT) {
      // A type-coloured shot with a short square trail.
      const t = (local - LUNGE_AT) / (RANGED_IMPACT - LUNGE_AT);
      for (let tail = 3; tail >= 0; tail--) {
        const at = Math.max(0, t - tail * .06), px = lerp(fromPoint.x, toPoint.x, at), py = lerp(fromPoint.y, toPoint.y, at) - Math.sin(at * Math.PI) * 10, size = 4 - tail;
        context.globalAlpha = 1 - tail * .22; context.fillStyle = tail ? color : '#FFFDF7';
        context.fillRect(Math.round(px - size / 2), Math.round(py - size / 2), size + 1, size + 1);
      }
      context.globalAlpha = 1;
    }
    if (local >= impact && !state.fired.has(`hit:${index}`)) {
      state.fired.add(`hit:${index}`);
      burst(toPoint.x, toPoint.y, color, effectTone(strike.effectiveness) === 'super' ? 22 : 12);
    }
    if (local >= impact && local < impact + 760) {
      const t = (local - impact) / 760;
      outlined(context, `−${strike.damage}`, toPoint.x, toPoint.y - 12 - t * 12, 9, '#FFF3C4');
      const tone = effectTone(strike.effectiveness);
      if (tone !== 'normal' && local > impact + 120) outlined(context, EFFECT_TEXT[tone].replace(/[！…]+$/, ''), toPoint.x, toPoint.y + 4, 6, tone === 'super' ? '#8FE3A0' : tone === 'weak' ? '#F2C14E' : '#C9D2D6');
    }
  }
  const particles = stepParticles(context, dt);
  // Classic info boxes: the side's last active Pokémon with its HP, and one ball per team member.
  for (const side of ['away', 'home'] as const) infoBox(context, battle, side, focusOf(replay, plan, index, battleIndex, side), hpOf, hpStart, battleIndex);
  if (beat.kind === 'result') resultBanner(context, replay, Math.min(1, local / 300));
  context.setTransform(1, 0, 0, 1, 0, 0);
  return particles;
}
/** The Pokémon shown in a side's info box: the one acting in or hit by the current strike, else the side's last one. */
function focusOf(replay: BattleReplay, plan: Plan, index: number, battleIndex: number, side: ReplaySide): ReplayFighter {
  const battle = replay.battles[battleIndex]!, team = side === 'home' ? battle.home : battle.away;
  for (let at = index; at >= 0; at--) {
    const beat = plan.beats[at]!;
    if (beat.kind !== 'strike' || beat.battle !== battleIndex) { if (beat.kind === 'intro' && beat.battle === battleIndex) break; continue; }
    const strike = battle.strikes[beat.strike]!, id = [strike.attackerId, strike.defenderId].find(item => team.some(member => member.id === item));
    if (id) return team.find(member => member.id === id)!;
  }
  return team.find(member => (plan.hp[index]!.get(qid(battleIndex, member.id)) ?? member.hp) > 0) ?? team[0]!;
}
function infoBox(context: CanvasRenderingContext2D, battle: ReplayBattle, side: ReplaySide, fighter: ReplayFighter, hpOf: (fighter: ReplayFighter) => number,
  hpStart: Map<string, number>, battleIndex: number) {
  const team = side === 'home' ? battle.home : battle.away, home = side === 'home';
  const box = home ? { x: 140, y: 101, w: 96, h: 30 } : { x: 4, y: 4, w: 92, h: 27 };
  context.fillStyle = '#10191B'; context.fillRect(box.x - 1, box.y - 1, box.w + 2, box.h + 2);
  context.fillStyle = '#F6EFD8'; context.fillRect(box.x, box.y, box.w, box.h);
  context.fillStyle = '#C9B88A'; context.fillRect(box.x, box.y + box.h - 2, box.w, 2);
  context.font = '700 7px system-ui, sans-serif'; context.textAlign = 'left'; context.textBaseline = 'top'; context.fillStyle = '#17262A';
  context.fillText(speciesDisplay(fighter.speciesId).name, box.x + 4, box.y + 3, box.w - 40);
  // Type colour chips (the attack type is the first).
  fighter.typeIds.forEach((type, order) => { context.fillStyle = TYPE_COLORS[type] ?? '#9AA6A0'; context.fillRect(box.x + box.w - 30 + order * 8, box.y + 4, 6, 5); });
  const hp = hpOf(fighter), barLeft = box.x + 16, barWidth = box.w - 22, barTop = box.y + 13;
  context.font = '800 5px system-ui, sans-serif'; context.fillStyle = '#C8952C'; context.fillText('HP', box.x + 4, barTop - 1);
  context.fillStyle = '#10191B'; context.fillRect(barLeft - 1, barTop - 1, barWidth + 2, 5);
  context.fillStyle = '#3A2A28'; context.fillRect(barLeft, barTop, barWidth, 3);
  context.fillStyle = hpColor(hp, fighter.maxHp); context.fillRect(barLeft, barTop, Math.round(barWidth * Math.max(0, hp) / fighter.maxHp), 3);
  context.font = '700 6px system-ui, sans-serif'; context.textAlign = 'right'; context.fillStyle = '#17262A';
  context.fillText(`${Math.max(0, hp)}/${fighter.maxHp}`, box.x + box.w - 4, box.y + (home ? 18 : 18));
  team.forEach((member, order) => ball(context, box.x + 7 + order * 8, box.y + (home ? 24 : 21), (member === fighter ? hp : hpStart.get(qid(battleIndex, member.id)) ?? member.hp) > 0));
}
function resultBanner(context: CanvasRenderingContext2D, replay: BattleReplay, t: number) {
  context.globalAlpha = .55 * t; context.fillStyle = '#071114'; context.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT); context.globalAlpha = 1;
  const icon = iconImage(replay.victory ? replay.kind === 'gym' ? 'badge' : replay.kind === 'guardian' ? 'tablet' : 'trophy' : 'damaged');
  const size = Math.round(24 + 10 * easeOut(t));
  if (icon.complete && icon.naturalWidth) context.drawImage(icon, Math.round(ARENA_WIDTH / 2 - size / 2), Math.round(46 - size / 2), size, size);
  outlined(context, replay.victory ? '胜利！' : '落败……', ARENA_WIDTH / 2, 80, 14, replay.victory ? '#FFE08A' : '#E8B5AE');
  outlined(context, replay.outcome, ARENA_WIDTH / 2, 98, 7, '#FFF8E5');
}

// ---------- captions and the step list ----------

function strikeText(battle: ReplayBattle, strike: ReplayStrike): { line: string; label: string } {
  const all = [...battle.home, ...battle.away], attacker = all.find(item => item.id === strike.attackerId)!, defender = all.find(item => item.id === strike.defenderId)!;
  const tone = effectTone(strike.effectiveness);
  const line = `${nameOf(attacker)}发动${TYPE_NAMES[strike.typeId]}属性攻击！${nameOf(defender)}受到 ${strike.damage} 点伤害。${EFFECT_TEXT[tone]}${strike.fainted ? `${nameOf(defender)}倒下了！` : ''}`;
  return { line, label: `第 ${strike.round} 回合：${line}（${multiplierText(strike.effectiveness)}，剩余 HP ${strike.hpAfter}/${defender.maxHp}）` };
}
function beatCaption(state: Viewer, index: number, local: number): string {
  const beat = state.plan.beats[index]!, replay = state.replay;
  if (beat.kind === 'result') return `${replay.victory ? '胜利！' : '落败……'}${replay.outcome}`;
  const battle = replay.battles[beat.battle]!;
  if (beat.kind === 'intro') {
    const alive = (team: ReplayFighter[]) => team.filter(item => (state.plan.hp[index]!.get(qid(beat.battle, item.id)) ?? item.hp) > 0).map(item => speciesDisplay(item.speciesId).name).join('、');
    return `${battle.healed ? `场间恢复：已损失 HP 的 ${battle.healed}%。` : ''}${battle.awayName}派出了${alive(battle.away)}！${beat.battle > 0 && battle.healed ? '' : `去吧，${alive(battle.home)}！`}`;
  }
  if (beat.kind === 'outro') {
    const losers = battle.winner === 'home' ? battle.away : battle.home;
    const allDown = losers.every(item => (state.plan.hp[index]!.get(qid(beat.battle, item.id)) ?? item.hp) <= 0);
    return `${battle.winner === 'home' ? `${battle.homeName}获胜` : `${battle.awayName}获胜`}${allDown ? '' : '（回合用尽，按剩余 HP 判定）'}！`;
  }
  const strike = battle.strikes[beat.strike]!, all = [...battle.home, ...battle.away], attacker = all.find(item => item.id === strike.attackerId)!;
  if (state.motion && local < impactAt(attacker) + 120) return `${nameOf(attacker)}发动${TYPE_NAMES[strike.typeId]}属性攻击！`;
  return strikeText(battle, strike).line;
}
function stepListMarkup(replay: BattleReplay, plan: Plan): string {
  return plan.beats.map((beat, index) => {
    if (beat.kind === 'intro') {
      const battle = replay.battles[beat.battle]!;
      return `<li class="bv-step-head" data-beat="${index}"><button type="button" data-seek="${index}">${uiIcon('swords', { size: 14 })}${escapeAttr(battle.title)} <small>${ARENA_NAMES[battle.arena]} · ${battle.rounds} 回合</small></button></li>`;
    }
    if (beat.kind !== 'strike') return '';
    const battle = replay.battles[beat.battle]!, strike = battle.strikes[beat.strike]!, all = [...battle.home, ...battle.away];
    const attacker = all.find(item => item.id === strike.attackerId)!, defender = all.find(item => item.id === strike.defenderId)!, tone = effectTone(strike.effectiveness);
    const { label } = strikeText(battle, strike);
    const effect = tone === 'super' ? 'matchupUp' : tone === 'weak' ? 'matchupDown' : tone === 'none' ? 'matchupNone' : null;
    return `<li class="bv-step ${attacker.side}${strike.fainted ? ' faint' : ''}" data-beat="${index}"><button type="button" data-seek="${index}" aria-label="${escapeAttr(label)}" title="${escapeAttr(label)}">
      <span class="bv-round" aria-hidden="true">R${strike.round}</span>${artImage(pokemonSpritePath(attacker.speciesId), { size: 28, className: attacker.side === 'home' ? 'bv-mirror' : '' })}
      <span class="bv-type" style="--type:${TYPE_COLORS[strike.typeId]}" aria-hidden="true"></span>${artImage(pokemonSpritePath(defender.speciesId), { size: 28, className: defender.side === 'home' ? 'bv-mirror' : '' })}
      <b aria-hidden="true">−${strike.damage}</b>${effect ? uiIcon(effect, { size: 14 }) : ''}${strike.fainted ? uiIcon('damaged', { size: 14 }) : ''}</button></li>`;
  }).join('');
}

// ---------- playback ----------

function setBeatUi(state: Viewer, force = false) {
  const index = beatAt(state.plan, state.time), local = state.time - state.plan.starts[index]!;
  const text = beatCaption(state, index, local);
  if (text !== state.captionText || force) { state.captionText = text; state.caption.textContent = text; }
  const beat = state.plan.beats[index]!;
  const round = beat.kind === 'strike' ? state.replay.battles[beat.battle]!.strikes[beat.strike]!.round : null;
  const sub = state.root.querySelector<HTMLElement>('#bv-sub')!;
  const battleText = state.replay.battles.length > 1 && beat.kind !== 'result' ? `第 ${beat.battle + 1} / ${state.replay.battles.length} 场 · ` : '';
  const subText = beat.kind === 'result' ? '结果' : `${battleText}${round ? `第 ${round} / ${state.replay.battles[beat.battle]!.rounds} 回合` : beat.kind === 'intro' ? '出场' : '结束'}`;
  if (sub.textContent !== subText) sub.textContent = subText;
  if (index !== state.beat || force) {
    state.beat = index; state.root.dataset.beat = String(index);
    for (const item of state.steps.querySelectorAll<HTMLElement>('.current')) item.classList.remove('current');
    const current = state.steps.querySelector<HTMLElement>(`[data-beat="${index}"]`);
    if (current) { current.classList.add('current'); current.scrollIntoView?.({ block: 'nearest' }); }
  }
  state.root.dataset.playing = String(state.playing);
  const play = state.root.querySelector<HTMLButtonElement>('#bv-play')!;
  const label = state.playing ? '暂停（空格）' : state.time >= state.plan.total ? '重新播放（空格）' : '播放（空格）';
  if (play.getAttribute('aria-label') !== label) { play.setAttribute('aria-label', label); play.title = label; play.textContent = state.playing ? '❚❚' : '▶'; }
}
function cueSounds(state: Viewer, from: number, to: number) {
  for (let index = beatAt(state.plan, from); index < state.plan.beats.length && state.plan.starts[index]! <= to; index++) {
    const beat = state.plan.beats[index]!, start = state.plan.starts[index]!;
    if (beat.kind === 'strike') {
      const battle = state.replay.battles[beat.battle]!, strike = battle.strikes[beat.strike]!;
      const attacker = [...battle.home, ...battle.away].find(item => item.id === strike.attackerId)!, at = start + impactAt(attacker);
      if (from < at && at <= to) { state.play(attackSound(strike.typeId)); if (effectTone(strike.effectiveness) === 'super') state.play('superEffective'); }
      if (strike.fainted && from < at + 520 && at + 520 <= to) state.play('knockdown');
    } else if (beat.kind === 'intro' && from < start + 380 && start + 380 <= to) state.play('select');
    else if (beat.kind === 'result' && from < start && start <= to && state.replay.victory) state.play('promotion');
  }
}
function tick(now: number) {
  const state = viewer;
  if (!state) return;
  state.frame = null;
  const dt = state.last === null ? 16 : Math.min(100, now - state.last);
  state.last = now;
  if (state.playing) {
    const from = state.time;
    state.time = Math.min(state.plan.total, state.time + dt * state.speed);
    cueSounds(state, from, state.time);
    if (state.time >= state.plan.total) state.playing = false;
  }
  const particles = draw(state, dt * (state.playing ? state.speed : 1));
  setBeatUi(state);
  if (state.playing || particles) state.frame = requestAnimationFrame(tick);
  else state.last = null;
}
function wake(state: Viewer) {
  if (!state.motion) { draw(state, 0); setBeatUi(state); return; }
  if (state.frame === null) state.frame = requestAnimationFrame(tick);
}
function seek(state: Viewer, time: number) {
  clearParticles();
  state.time = Math.max(0, Math.min(state.plan.total, time)); state.fired.clear();
  draw(state, 0); setBeatUi(state); wake(state);
}
function seekBeat(state: Viewer, index: number) {
  const beat = Math.max(0, Math.min(state.plan.beats.length - 1, index));
  // In still mode a strike is shown as its result (the end of its beat).
  seek(state, state.motion ? state.plan.starts[beat]! : beat + 1 < state.plan.beats.length ? state.plan.starts[beat + 1]! - 1 : state.plan.total);
}

/** Size and place the viewer off the action bar, the notification rail, the objective card and the combat card. */
function layout(state: Viewer) {
  const screen = document.querySelector('#screen-host:not([hidden])');
  const obstacles = screen ? [] : ['#unit-action-bar', '#toast-host', '#opening-goals', '#combat-card', '#gym-card', '#challenge-card'].flatMap(selector => {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element || element.hidden || !element.offsetParent && getComputedStyle(element).position !== 'fixed') return [];
    const rect = element.getBoundingClientRect();
    return rect.width && rect.height ? [{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }] : [];
  });
  const area = { width: window.innerWidth, height: window.innerHeight };
  const overlap = (a: { left: number; top: number; width: number; height: number }) => obstacles.some(rect => a.left < rect.left + rect.width && rect.left < a.left + a.width && a.top < rect.top + rect.height && rect.top < a.top + a.height);
  let chosen: { scale: number; left: number; top: number } | null = null;
  for (const scale of [3, 2]) {
    state.scale = scale; sizeCanvas(state);
    const size = { width: state.root.offsetWidth, height: state.root.offsetHeight };
    if (size.width > area.width - 16 || size.height > area.height - 16) continue;
    const spot = placeCard(size, { x: area.width / 2, y: area.height / 2 }, area, obstacles, 0, 8);
    chosen = { scale, ...spot };
    if (!overlap({ ...spot, ...size })) break;
  }
  if (!chosen) { state.scale = 2; sizeCanvas(state); chosen = { scale: 2, left: 8, top: 8 }; }
  state.scale = chosen.scale; sizeCanvas(state);
  state.root.style.left = `${chosen.left}px`; state.root.style.top = `${chosen.top}px`;
  state.root.dataset.scale = String(chosen.scale);
}
function sizeCanvas(state: Viewer) {
  const ratio = window.devicePixelRatio || 1, width = ARENA_WIDTH * state.scale, height = ARENA_HEIGHT * state.scale;
  state.canvas.style.width = `${width}px`; state.canvas.style.height = `${height}px`;
  state.canvas.width = Math.round(width * ratio); state.canvas.height = Math.round(height * ratio);
  state.root.style.width = `${width + 20}px`;
}

export type ViewerOptions = { reducedMotion?: boolean; play?: (id: SoundId) => void; onClose?: () => void };
/** Opens the replay (replacing an open one). */
export function openBattleViewer(replay: BattleReplay, options: ViewerOptions = {}): void {
  closeBattleViewer();
  const motion = !options.reducedMotion, plan = planReplay(replay);
  const root = document.createElement('section');
  root.id = 'battle-viewer'; root.className = `battle-viewer${motion ? '' : ' still'}`;
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-labelledby', 'bv-title');
  root.dataset.mode = motion ? 'animated' : 'still'; root.dataset.kind = replay.kind;
  const battle = replay.battles[0]!;
  root.innerHTML = `<header class="bv-head">${uiIcon(replay.kind === 'gym' ? 'badge' : replay.kind === 'guardian' ? 'sanctuary' : 'trophy', { size: 22, label: { gym: '道馆挑战', guardian: '圣所守卫', elite: '四天王', league: '联盟大会' }[replay.kind] })}
      <div><h3 id="bv-title">${escapeAttr(replay.title)}</h3><small id="bv-sub"></small></div>
      <button type="button" class="bv-close" id="bv-close" aria-label="关闭回放（Esc）" title="关闭回放（Esc）">×</button></header>
    <div class="bv-stage"><canvas id="bv-canvas" role="img" aria-label="${escapeAttr(`对战画面：${battle.homeName} 对 ${battle.awayName}，${ARENA_NAMES[battle.arena]}`)}"></canvas></div>
    <p class="bv-caption" id="bv-caption" aria-live="polite"></p>
    <div class="bv-controls" role="toolbar" aria-label="回放控制">
      <button type="button" id="bv-prev" aria-label="上一步（←）" title="上一步（←）">⏮</button>
      <button type="button" id="bv-play" ${motion ? '' : 'hidden'}>▶</button>
      <button type="button" id="bv-next" aria-label="下一步（→）" title="下一步（→）">⏭</button>
      <button type="button" id="bv-speed" ${motion ? '' : 'hidden'} aria-label="播放速度 ×1（点击切换）" title="播放速度 ×1（点击切换）">×1</button>
      <button type="button" id="bv-skip" aria-label="跳到结果（End）" title="跳到结果（End）">⏩ 结果</button>
    </div>
    <ol class="bv-steps" id="bv-steps" aria-label="逐回合记录">${stepListMarkup(replay, plan)}</ol>`;
  document.body.append(root);
  const canvas = root.querySelector<HTMLCanvasElement>('#bv-canvas')!;
  const state: Viewer = { root, canvas, context: canvas.getContext('2d')!, caption: root.querySelector('#bv-caption')!, steps: root.querySelector('#bv-steps')!,
    replay, plan, time: motion ? 0 : plan.total, playing: motion, speed: 1, motion, scale: 3, last: null, frame: null, beat: -1, captionText: '',
    play: options.play ?? (() => undefined), onClose: options.onClose, fired: new Set() };
  viewer = state;
  clearParticles();
  layout(state);
  draw(state, 0); setBeatUi(state, true); wake(state);
  root.querySelector('#bv-close')!.addEventListener('click', closeBattleViewer);
  root.querySelector('#bv-play')!.addEventListener('click', () => togglePlay(state));
  root.querySelector('#bv-next')!.addEventListener('click', () => { state.playing = false; seekBeat(state, beatAt(state.plan, state.time) + 1); });
  root.querySelector('#bv-prev')!.addEventListener('click', () => { state.playing = false; seekBeat(state, beatAt(state.plan, state.time) - (state.motion && state.time > state.plan.starts[beatAt(state.plan, state.time)]! + 200 ? 0 : 1)); });
  root.querySelector('#bv-skip')!.addEventListener('click', () => { state.playing = false; seek(state, state.plan.total); });
  root.querySelector('#bv-speed')!.addEventListener('click', event => {
    state.speed = state.speed === 1 ? 2 : state.speed === 2 ? 4 : 1;
    const button = event.currentTarget as HTMLButtonElement, label = `播放速度 ×${state.speed}（点击切换）`;
    button.textContent = `×${state.speed}`; button.setAttribute('aria-label', label); button.title = label; root.dataset.speed = String(state.speed);
  });
  state.steps.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-seek]');
    if (button) { state.playing = false; seekBeat(state, Number(button.dataset.seek)); }
  });
  root.addEventListener('keydown', event => {
    if (event.key === ' ' && state.motion) { event.preventDefault(); togglePlay(state); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); root.querySelector<HTMLButtonElement>('#bv-next')!.click(); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); root.querySelector<HTMLButtonElement>('#bv-prev')!.click(); }
    else if (event.key === 'End') { event.preventDefault(); root.querySelector<HTMLButtonElement>('#bv-skip')!.click(); }
  });
  window.addEventListener('keydown', escapeKey, { capture: true });
  window.addEventListener('resize', relayout);
  root.dataset.speed = '1';
  root.querySelector<HTMLButtonElement>(motion ? '#bv-play' : '#bv-close')!.focus({ preventScroll: true });
}
function togglePlay(state: Viewer) {
  if (!state.motion) return;
  if (state.playing) state.playing = false;
  else { if (state.time >= state.plan.total) seek(state, 0); state.playing = true; state.last = null; }
  setBeatUi(state); wake(state);
}
function escapeKey(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !viewer) return;
  event.preventDefault(); event.stopImmediatePropagation(); closeBattleViewer();
}
function relayout() { if (viewer) { layout(viewer); draw(viewer, 0); } }
export function closeBattleViewer(): void {
  const state = viewer;
  if (!state) return;
  viewer = null;
  if (state.frame !== null) cancelAnimationFrame(state.frame);
  window.removeEventListener('keydown', escapeKey, { capture: true });
  window.removeEventListener('resize', relayout);
  state.root.remove(); clearParticles();
  state.onClose?.();
}
export const battleViewerOpen = () => viewer !== null;
