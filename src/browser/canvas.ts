// Map legend data shared by the panels. Drawing lives in ./render/ (scene → Canvas 2D backend).
import type { BiomeId } from '../content/rules.ts';

export const BIOME_DISPLAY: Record<BiomeId, { label: string; color: string; symbol: string }> = {
  grassland: { label: '草原', color: '#76975D', symbol: '≈' },
  forest: { label: '森林', color: '#3F684E', symbol: '♠' },
  mountain: { label: '山地', color: '#737B70', symbol: '⋀⋀' },
  ocean: { label: '海洋', color: '#397B92', symbol: '≈' },
  desert: { label: '荒漠', color: '#C5A364', symbol: '∿' },
  snow: { label: '雪原', color: '#BFD5D5', symbol: '✣' },
  volcano: { label: '火山', color: '#594944', symbol: '⋀' },
};
export const FACTION_LEGEND = [
  { id: 0, label: '文明 1 · 实心', className: 'faction-solid' },
  { id: 1, label: '文明 2 · 斜线', className: 'faction-diagonal' },
  { id: 2, label: '文明 3 · 圆点', className: 'faction-dots' },
  { id: 3, label: '文明 4 · 交叉线', className: 'faction-cross' },
];
