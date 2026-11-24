import type { GameState, KnowledgeState } from './model.ts';
import type { ExpansionState } from './expansion-model.ts';

/**
 * Pure ES2022 deep cloner for JSON-shaped values (zero DOM/Node globals, matches
 * `JSON.parse(JSON.stringify(value))` semantics for plain objects, arrays, and primitives).
 */
export function clonePlain<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const length = value.length;
    const copy = new Array(length);
    for (let index = 0; index < length; index++) {
      const item = value[index];
      copy[index] = item === undefined ? null : clonePlain(item);
    }
    return copy as unknown as T;
  }
  const copy: Record<string, unknown> = {};
  const source = value as Record<string, unknown>;
  for (const key in source) {
    if (Object.hasOwn(source, key)) {
      const item = source[key];
      if (item !== undefined) copy[key] = clonePlain(item);
    }
  }
  return copy as T;
}

/**
 * Copy-on-write clone of `KnowledgeState` for `step()`.
 * `refreshKnowledge` / `rememberDistricts` only replace entries in `rememberedTiles`,
 * `lastKnownUnits`, `lastKnownCities`, and `rememberedDistricts` by assignment (never mutating
 * existing leaf entries in place), so shallow-copying the maps avoids cloning thousands of
 * immutable remembered-tile objects on every command.
 */
function cloneKnowledgeRecord(knowledge: Record<number, KnowledgeState>): Record<number, KnowledgeState> {
  const copy: Record<number, KnowledgeState> = {};
  for (const key in knowledge) {
    if (!Object.hasOwn(knowledge, key)) continue;
    const entry = knowledge[key];
    copy[key] = {
      exploredTileIds: entry.exploredTileIds.slice(),
      rememberedTiles: { ...entry.rememberedTiles },
      lastKnownUnits: { ...entry.lastKnownUnits },
      lastKnownCities: { ...entry.lastKnownCities },
      ...(entry.rememberedDistricts ? { rememberedDistricts: { ...entry.rememberedDistricts } } : {}),
    };
  }
  return copy;
}

/**
 * Copy-on-write clone of `ExpansionState` for `step()`.
 * - `civilization.championship.history` entries are append-only historical season records (never
 *   mutated after creation), so shallow-copying the array avoids cloning ~250 KB of battle traces
 *   on every command.
 * - `world.players[*].pokedex` entries are replaced copy-on-write (never mutated in place), so
 *   shallow-copying each player's `pokedex` map avoids cloning ~600 species records per command.
 */
function cloneExpansionForStep(expansion: ExpansionState): ExpansionState {
  const copy: Record<string, unknown> = {};
  const source = expansion as unknown as Record<string, unknown>;
  for (const key in source) {
    if (!Object.hasOwn(source, key)) continue;
    const item = source[key];
    if (item === undefined) continue;
    if (key === 'civilization' && item && typeof item === 'object') {
      const civ = expansion.civilization;
      const civCopy: Record<string, unknown> = {};
      for (const cKey in civ) {
        if (!Object.hasOwn(civ, cKey)) continue;
        const cItem = (civ as unknown as Record<string, unknown>)[cKey];
        if (cItem === undefined) continue;
        if (cKey === 'championship') {
          const champ = civ.championship;
          civCopy.championship = {
            nextSeason: champ.nextSeason,
            nextRound: champ.nextRound,
            intervalRounds: champ.intervalRounds,
            registrations: clonePlain(champ.registrations),
            history: champ.history.slice(),
            titlesByPlayer: { ...champ.titlesByPlayer },
            victory: champ.victory ? { ...champ.victory } : null,
          };
        } else {
          civCopy[cKey] = clonePlain(cItem);
        }
      }
      copy.civilization = civCopy;
    } else if (key === 'world' && item && typeof item === 'object') {
      const world = expansion.world;
      const playersCopy: Record<number, unknown> = {};
      for (const pKey in world.players) {
        if (!Object.hasOwn(world.players, pKey)) continue;
        const p = world.players[Number(pKey)];
        playersCopy[Number(pKey)] = {
          satisfaction: p.satisfaction,
          berryInventory: { ...p.berryInventory },
          stoneInventory: { ...p.stoneInventory },
          pokedex: { ...p.pokedex },
          lastProsperityRound: p.lastProsperityRound,
        };
      }
      copy.world = {
        version: world.version,
        initializedAtRound: world.initializedAtRound,
        nests: clonePlain(world.nests),
        rampagingUnitIds: world.rampagingUnitIds.slice(),
        overlords: clonePlain(world.overlords),
        resources: clonePlain(world.resources),
        players: playersCopy,
        victory: { ...world.victory },
      };
    } else {
      copy[key] = clonePlain(item);
    }
  }
  return copy as unknown as ExpansionState;
}

/**
 * Structural copy-on-write clone for `step()`.
 * - `state.map` and `state.setup` are strictly immutable after `createGame()`, so they are shared.
 * - When `shareKnowledge` is true (actions guaranteed not to alter vision, territory, or knowledge),
 *   `state.knowledge` is also shared; otherwise only its top-level maps are shallow-copied.
 * - `state.expansion` uses CoW for append-only championship history and per-species Pokédex records.
 */
export function cloneStateForStep(state: GameState, options?: { shareKnowledge?: boolean }): GameState {
  const shareKnowledge = options?.shareKnowledge === true;
  const copy: Record<string, unknown> = {};
  const source = state as unknown as Record<string, unknown>;
  for (const key in source) {
    if (!Object.hasOwn(source, key)) continue;
    const item = source[key];
    if (item === undefined) continue;
    if (key === 'map' || key === 'setup') copy[key] = item;
    else if (key === 'knowledge') copy[key] = shareKnowledge ? item : cloneKnowledgeRecord(state.knowledge);
    else if (key === 'expansion') copy[key] = cloneExpansionForStep(state.expansion!);
    else copy[key] = clonePlain(item);
  }
  return copy as unknown as GameState;
}
