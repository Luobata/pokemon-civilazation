// ui-painted: the visual theme. `pixel` is the original look (flat or 2.5D pixel map, chosen under 地图视角); `painted` (绘卷) is
// the illustrated map with the ornamental HUD (docs/design/ui-painted.md). `?theme=painted` (alias `atlas`) or `?theme=pixel`
// wins over the saved 菜单 → 画风 choice. The HUD styles live in painted.css, scoped under `html.theme-painted`.
import '../painted.css';

export type Theme = 'pixel' | 'painted';
export const THEME_KEY = 'pokeciv.theme';

export function requestedTheme(search: string, stored: string | null): Theme {
  const param = new URLSearchParams(search).get('theme');
  if (param === 'painted' || param === 'atlas') return 'painted';
  if (param === 'pixel') return 'pixel';
  return stored === 'painted' ? 'painted' : 'pixel';
}
export function storedTheme(): string | null {
  try { return localStorage.getItem(THEME_KEY); } catch { return null; }
}
export function saveTheme(theme: Theme): void {
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* private mode: the choice lasts for this page */ }
}
/** Marks the document so the theme's CSS applies (`html.theme-painted`). */
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('theme-painted', theme === 'painted');
  document.documentElement.dataset.theme = theme;
}
