// Map-art comparison (docs/design/map-art-options.md): a dev-only seam that lets an alternative art set replace the painted
// theme's standing props, coast edges and towns. Nothing is installed by default, so the shipped renderer is unchanged.
// `?mapart=svg` installs option A (original authored SVGs from public/map-art/painted/, map-art-svg.ts); a provider returns
// undefined for anything it does not cover and the procedural art (terrain.ts / tokens.ts) is drawn instead.
import type { BiomeId } from '../../../content/rules.ts';

/** A baked prop: (ox, oy) is the tile centre inside the canvas, as in terrain.ts. */
export type ArtProp = { canvas: HTMLCanvasElement; ox: number; oy: number } | null;
export type ArtTown = { town: HTMLCanvasElement; lights: HTMLCanvasElement };
export type ArtTownLook = { color: string; population: number; capital: boolean; wonders: number };
export type MapArt = {
  id: string;
  /** Props of a tile at device-pixel radius bucket R and squash sq (canvas centre convention of terrain.ts's propSprite). */
  prop?(biome: BiomeId, variant: number, hill: boolean, peak: boolean, R: number, sq: number): ArtProp | undefined;
  /** A town on a canvas of R × TOWN size (tokens.ts), tile centre at (TOWN.ox, TOWN.oy) × R. */
  town?(look: ArtTownLook, R: number, sq: number): ArtTown | undefined;
  /**
   * One coast edge: called with the context translated to the edge midpoint and rotated so +x runs along the edge (length
   * `length`, device-independent units) and +y points out to sea; squash is already applied. Returns false to fall back.
   */
  coastEdge?(g: CanvasRenderingContext2D, length: number, radius: number, shore: 'sand' | 'snow' | 'volcanic' | 'rock'): boolean;
};

let current: MapArt | null = null, version = 0;
/** The installed art set, if any. */
export const mapArt = (): MapArt | null => current;
/** Bumped whenever the art set changes or finishes loading; part of every cache key that holds art. */
export const mapArtVersion = (): number => version;
export function setMapArt(art: MapArt | null): void { current = art; version++; }
/** A cache-key fragment for the current art set. */
export const mapArtKey = (): string => current ? `${current.id}.${version}` : '-';

/** Resolves once a dev-flag art set has loaded (immediately when none is requested). */
export const mapArtReady: Promise<void> = (() => {
  if (typeof location === 'undefined') return Promise.resolve();
  const flag = new URLSearchParams(location.search).get('mapart');
  if (flag !== 'svg') return Promise.resolve();
  return import('./map-art-svg.ts').then(module => module.loadSvgArt()).then(art => setMapArt(art), error => console.warn('mapart=svg failed', error));
})();
