import { expect, test } from 'vitest';
import { iconGrid, iconStyle, iconUrl, pixelIconBox, setIconStyle, statChip, typeBadge, uiIcon, UI_ICON_NAMES, artImage, VECTOR_ICON_NAMES, vectorIconUrl } from '../../src/browser/ui-icons.ts';
import { TECH_ICONS, unlockChip } from '../../src/browser/unlock-icons.ts';
import { techUnlocks } from '../../src/browser/tech-info.ts';
import { TREE_TECH_IDS } from '../../src/content/tech-tree.ts';
import { WORLD_CONTENT } from '../../src/content/units.ts';
import { TYPE_NAMES } from '../../src/content/type-names.ts';

test('the icon kit covers types, classes, HMs, meters, items and unlock kinds; every grid is rectangular and fully paletted', () => {
  const required = ['type:fire', 'type:fairy', 'gym:water', 'class:melee', 'class:naval', 'hm:surf', 'hm:strength', 'hm:ride', 'hm:fly',
    'civics', 'faith', 'eraScore', 'satisfaction', 'badge', 'essence', 'essence:tide', 'pokeBall', 'greatBall', 'masterBall', 'oranBerry', 'fireStone',
    'building', 'unit', 'district', 'improvement', 'policyCard', 'wonder', 'attack', 'defense', 'move', 'range', 'heart', 'food', 'harborDistrict'];
  for (const name of required) expect(UI_ICON_NAMES, name).toContain(name);
  expect(UI_ICON_NAMES.filter(name => name.startsWith('type:'))).toHaveLength(18);
  expect(UI_ICON_NAMES.filter(name => name.startsWith('class:'))).toHaveLength(7);
  for (const name of UI_ICON_NAMES) {
    const { rows, palette } = iconGrid(name);
    expect(new Set(rows.map(row => row.length)).size, name).toBe(1);
    for (const cell of new Set(rows.join(''))) if (cell !== '.') expect(palette[cell], `${name} cell ${cell}`).toMatch(/^#[0-9A-F]{6}$/i);
    expect(iconUrl(name)).toMatch(/^data:image\/svg\+xml,/);
  }
});

test('icons are named or explicitly decorative', () => {
  expect(uiIcon('badge')).toContain('aria-hidden="true"');
  expect(uiIcon('badge', { label: '徽章' })).toMatch(/alt="徽章" title="徽章"/);
  expect(typeBadge('fire')).toContain(`alt="${TYPE_NAMES.fire}属性"`);
  expect(statChip('research', 50, '科研')).toContain('aria-label="科研 50" role="img"');
  expect(artImage('/buildings/workshop.svg', { label: '精灵球工坊' })).toContain('alt="精灵球工坊"');
});

test('every v22 tech has a subject icon, and each unlock chip carries its full sentence as its accessible name', () => {
  for (const id of TREE_TECH_IDS) {
    expect(UI_ICON_NAMES, id).toContain(TECH_ICONS[id]);
    for (const item of techUnlocks(id, WORLD_CONTENT, 22)) expect(unlockChip(item, id), `${id}: ${item.text}`).toContain(`：${item.text.replace(/"/g, '&quot;')}" title=`);
  }
});

test('the painted theme swaps in smooth vector icons for the most visible names; others fall back to the pixel grid', () => {
  const visible = ['food', 'production', 'gold', 'research', 'civics', 'faith', 'satisfaction', 'turns', 'rush', 'clipboard', 'pokeBall', 'greatBall', 'masterBall',
    'essence', 'essence:tide', 'attack', 'defense', 'move', 'range', 'heart', 'shield', 'star', 'check', 'lock', 'trophy', 'type:fire', 'class:scout', 'gym:water', 'hm:surf',
    'action:move', 'action:found', 'action:skip'];
  for (const name of visible) expect(VECTOR_ICON_NAMES, name).toContain(name);
  for (const name of VECTOR_ICON_NAMES) {
    const svg = decodeURIComponent(vectorIconUrl(name)!.replace('data:image/svg+xml,', ''));
    expect(svg, name).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" class="vector-icon" viewBox="0 0 24 24">/);
    expect(svg, name).not.toMatch(/NaN|undefined|\{[sd]\}/);
  }
  try {
    setIconStyle('vector');
    expect(iconStyle()).toBe('vector');
    expect(uiIcon('gold', { size: 18 })).toMatch(/class="px-icon vec-icon" src="data:image\/svg\+xml,[^"]*vector-icon[^"]*" width="18" height="18"/);
    expect(uiIcon('oranBerry')).not.toContain('vec-icon');
  } finally { setIconStyle('pixel'); }
  expect(uiIcon('gold')).not.toContain('vec-icon');
});

test('pixel icons snap to a whole number of device pixels per grid cell', () => {
  expect(pixelIconBox(9, 9, 18, 1)).toEqual({ width: 18, height: 18 });
  expect(pixelIconBox(12, 12, 16, 1)).toEqual({ width: 12, height: 12 });
  expect(pixelIconBox(12, 12, 16, 2)).toEqual({ width: 18, height: 18 });
  expect(pixelIconBox(12, 10, 20, 1.5)).toEqual({ width: 24, height: 20 });
  expect(pixelIconBox(12, 12, 4, 1)).toEqual({ width: 12, height: 12 });
  expect(uiIcon('food', { size: 18 })).toContain('width="18" height="18"');
});
