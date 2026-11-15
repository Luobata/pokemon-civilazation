// Playtest 2026-11b (batch D): client-side plans and to-do helpers. Presentation only — none of this is a command, a log entry or
// save data: the research queue issues ordinary SetResearch commands at the start of the player's turn (as go-to orders issue
// Move commands), and the conference reminder only routes the end-turn button. Everything is cleared on new game, load and replay.
import type { TechId } from '../content/economy.ts';
import { CIVILIZATION_CONTENT } from '../content/civilization-systems.ts';
import { contentForView, techOf } from '../content/units.ts';
import type { Content } from '../content/units.ts';
import { canResearch } from '../core/economy-commands.ts';
import type { Command, PlayerView } from '../core/model.ts';

// ---------- research queue ----------

/** The techs the player queued, in order (Civilization-style: queuing a locked tech queues its missing prerequisites first). */
export class ResearchQueue {
  private ids: TechId[] = [];
  list(): readonly TechId[] { return this.ids; }
  /** 1-based place in the queue, 0 when not queued. */
  position(id: TechId): number { return this.ids.indexOf(id) + 1; }
  clear(): void { this.ids = []; }
  /** Queues `id` after its missing prerequisites (each once, in dependency order); done and current techs are skipped. Returns what was added. */
  add(view: PlayerView, id: TechId, content: Content = contentForView(view)): TechId[] {
    const research = view.economy.player.research, added: TechId[] = [];
    const visit = (tech: TechId, trail: Set<TechId>) => {
      if (trail.has(tech) || research.unlockedIds.includes(tech) || this.ids.includes(tech) || added.includes(tech) || !Object.hasOwn(content.techs, tech)) return;
      trail.add(tech);
      for (const requirement of techOf(content, tech).requires ?? []) visit(requirement, trail);
      if (tech !== research.techId) added.push(tech);
    };
    visit(id, new Set());
    this.ids.push(...added);
    return added;
  }
  /** Removes `id` and every queued tech that needs it (directly or through another queued tech). */
  remove(id: TechId, content: Content): void {
    const gone = new Set<TechId>([id]);
    for (let changed = true; changed;) {
      changed = false;
      for (const tech of this.ids) if (!gone.has(tech) && (techOf(content, tech).requires ?? []).some(requirement => gone.has(requirement))) { gone.add(tech); changed = true; }
    }
    this.ids = this.ids.filter(tech => !gone.has(tech));
  }
  /** Drops finished techs and the one being researched. */
  prune(view: PlayerView): void {
    const research = view.economy.player.research;
    this.ids = this.ids.filter(tech => !research.unlockedIds.includes(tech) && tech !== research.techId);
  }
  /** The first queued tech that can be researched now (null while one is being researched or nothing queued is open). */
  next(view: PlayerView, content: Content = contentForView(view)): TechId | null {
    this.prune(view);
    if (view.economy.player.research.techId !== null) return null;
    return this.ids.find(tech => canResearch(view.economy.player, tech, content)) ?? null;
  }
}
export const researchQueue = new ResearchQueue();

/**
 * At the start of the player's turn (and when the queue changes with nothing being researched): starts the next queued tech.
 * `issue` is the session's raw command path; returns the tech started, or null.
 */
export function runResearchQueue(view: PlayerView, issue: (action: Command['action']) => { ok: boolean }): TechId | null {
  if (view.outcome || view.activePlayerId !== view.playerId) return null;
  const next = researchQueue.next(view);
  if (!next || !issue({ type: 'SetResearch', techId: next }).ok) return null;
  return next;
}

// ---------- league conference registration (O3) ----------

/** Rounds before a season in which an unregistered, eligible player is reminded (and the end-turn button routes there once a round). */
export const CONFERENCE_REMINDER_ROUNDS = 5;
/** Rounds left before the season when the viewer should register now, else null (registered, at war, too few Pokémon, too early). */
export function conferenceDue(view: PlayerView): number | null {
  const championship = view.expansion?.civilization?.championship;
  if (!championship || championship.victory || championship.registration || view.outcome) return null;
  const left = championship.nextRound - view.round;
  if (left < 0 || left > CONFERENCE_REMINDER_ROUNDS) return null;
  const peaceful = !view.diplomacy.some(pair => pair.status === 'war' && (pair.a === view.playerId || pair.b === view.playerId));
  const own = view.units.filter(unit => unit.ownerId === view.playerId && unit.kind === 'pokemon').length;
  return peaceful && own >= CIVILIZATION_CONTENT.championship.teamSize ? left : null;
}
let conferenceShownRound = -1;
/** The end-turn button already led the player to the registration this round (a second plain click goes on). */
export const conferenceReviewed = (view: PlayerView) => conferenceShownRound === view.round;
export const markConferenceReviewed = (view: PlayerView) => { conferenceShownRound = view.round; };

/** New game, load, replay: no queue and no reminder state from another position. */
export function clearClientPlans(): void {
  researchQueue.clear(); conferenceShownRound = -1;
}
