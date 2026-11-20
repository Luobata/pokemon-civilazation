// 绘卷 map art (docs/design/map-art-options.md, option A): the seam through which the painted theme's standing props, coast edges and
// towns come from original authored SVGs (public/map-art/painted/, composed by map-art-svg.ts). It is the painted theme's default:
// the first painted renderer starts loading it, and `?mapart=proc` keeps the older procedural art (terrain.ts / tokens.ts) for
// comparison. A provider returns undefined for anything it does not cover and the procedural art is drawn instead; until the art
// has loaded the procedural art stands in, and a change listener asks for a fresh frame once it is ready.
import type { LandmarkId } from '../../../content/terrain.ts';
import type { BiomeId } from '../../../content/rules.ts';

/** A baked prop: (ox, oy) is the tile centre inside the canvas, as in terrain.ts. */
export type ArtProp = { canvas: HTMLCanvasElement; ox: number; oy: number } | null;
export type ArtTown = { town: HTMLCanvasElement; lights: HTMLCanvasElement };
export type ArtTownLook = { color: string; population: number; capital: boolean; wonders: number };
/**
 * What a tile's props depend on. `variant` (0–3) and `alt` (0–1) are stable per-tile hashes of the tile index; `woods` bit d is set when
 * the neighbour in HEX_DIRECTIONS d is wooded (forest edges).
 */
export type ArtTile = { biome: BiomeId; variant: number; alt: number; hill: boolean; peak: boolean; lake: boolean; landmark: LandmarkId | null; woods: number };
/** How a coast edge ends at each corner: the third tile there is land (a bay), water (a cape), or unknown. */
export type CoastEnd = 'bay' | 'cape' | 'open';
export type Shore = 'sand' | 'snow' | 'volcanic' | 'rock';
export type MapArt = {
  id: string;
  /** Cache-key fragment of a tile (only the fields the art reads), or null when the art does not cover it. */
  propKey?(tile: ArtTile): string | null;
  /** Props of a tile at device-pixel radius bucket R and squash sq (canvas centre convention of terrain.ts's propSprite). */
  prop?(tile: ArtTile, R: number, sq: number): ArtProp | undefined;
  /** The same props drawn in the fog's brown ink on parchment (fog.ts); undefined falls back to the procedural ink glyph. */
  inked?(tile: ArtTile, R: number, sq: number): ArtProp | undefined;
  /** True when the art draws landmarks itself (terrain.ts then adds only the small glyph disc). */
  landmarks?: boolean;
  /** A town on a canvas of R × TOWN size (tokens.ts), tile centre at (TOWN.ox, TOWN.oy) × R. */
  town?(look: ArtTownLook, R: number, sq: number): ArtTown | undefined;
  /**
   * One coast edge: called with the context translated to the edge midpoint and rotated so +x runs along the edge from the `ends[0]`
   * corner to the `ends[1]` corner (length `radius`, CSS units) and +y points out to sea; squash is already applied. False falls back.
   */
  coastEdge?(g: CanvasRenderingContext2D, radius: number, R: number, shore: Shore, ends: readonly [CoastEnd, CoastEnd]): boolean;
};

let current: MapArt | null = null, version = 0, loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
/** The installed art set, if any. */
export const mapArt = (): MapArt | null => current;
/** Bumped whenever the art set changes or finishes loading; part of every cache key that holds art. */
export const mapArtVersion = (): number => version;
export function setMapArt(art: MapArt | null): void { current = art; version++; for (const listener of listeners) listener(); }
/** A cache-key fragment for the current art set. */
export const mapArtKey = (): string => current ? `${current.id}.${version}` : '-';
/** Calls `listener` whenever the art set changes (main.ts redraws the map). */
export function onMapArtChange(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }

/** `?mapart=proc` (or `procedural`) keeps the procedural props; anything else uses the authored SVG art. */
export const svgArtWanted = (search: string): boolean => !/^proc(edural)?$/.test(new URLSearchParams(search).get('mapart') ?? '');
/** Starts loading the SVG art once (the painted renderer calls this); resolves when it is installed or has failed. */
export function loadMapArt(): Promise<void> {
  if (loading) return loading;
  if (typeof location === 'undefined' || typeof document === 'undefined' || !svgArtWanted(location.search)) return loading = Promise.resolve();
  return loading = import('./map-art-svg.ts').then(module => module.loadSvgArt()).then(art => setMapArt(art), error => console.warn('map art failed to load', error));
}
