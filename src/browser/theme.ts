// ui-painted: the visual theme. `pixel` is the original look (flat or 2.5D pixel map, chosen under 地图视角); `painted` (绘卷) is
// the illustrated map with the ornamental HUD (docs/design/ui-painted.md). `?theme=painted` (alias `atlas`) or `?theme=pixel`
// wins over the saved 菜单 → 画风 choice. The HUD styles live in painted.css, scoped under `html.theme-painted`.
import { setIconStyle } from './ui-icons.ts';

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
  setIconStyle(theme === 'painted' ? 'vector' : 'pixel');
}

// ---------- Font roles (docs/design/fidelity/README.md) ----------
// Mirrored from the `--font-*` custom properties in src/styles.css for canvas text, which cannot read CSS variables. System fonts
// only (nothing is bundled or hotlinked): a CJK face comes first so Latin letters and numerals render from the same family as the
// Chinese around them instead of falling back to a different face; "UI Latin Marks" (an @font-face in styles.css) only narrows
// "·" and "×".
/** UI sans: PingFang (macOS / iOS), Microsoft YaHei (Windows), Noto Sans CJK / Source Han Sans (Linux, Android). */
export const FONT_UI = '"UI Latin Marks", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC", "WenQuanYi Micro Hei", system-ui, sans-serif';
/** Display serif of the 绘卷 (painted) theme: titles, medallion numbers, map banners. */
export const FONT_DISPLAY = '"UI Latin Marks", "Noto Serif CJK SC", "Noto Serif SC", "Source Han Serif SC", "Source Han Serif CN", "Songti SC", "STSong", "SimSun", serif';
