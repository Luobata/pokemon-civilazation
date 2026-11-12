import { expect, test } from 'vitest';
import { iconGrid, iconUrl, statChip, typeBadge, uiIcon, UI_ICON_NAMES, artImage } from '../../src/browser/ui-icons.ts';
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

