import { expect, test } from '@playwright/test';
import { generateMap } from '../../src/core/map.ts';
import { canonicalSerialize, stateDigest } from '../../src/core/snapshot.ts';

for (const seed of [12345, 0]) {
  test(`Canvas renders seed ${seed}; browser state matches Node`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`/?seed=${seed}`);
    await expect(page.getByRole('status')).toContainText(`种子 ${seed} · 4 个文明`);
    await expect(page.getByRole('list', { name: '群系图例' }).locator('li')).toHaveCount(7);
    const pixels = await page.locator('canvas').evaluate(element => {
      const canvas = element as HTMLCanvasElement;
      const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let painted = 0;
      const colors = new Set<string>();
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 0) painted++;
        if (data[i + 3] === 255) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      }
      return { painted, total: data.length / 4, colors: colors.size };
    });
    expect(pixels.painted / pixels.total).toBeGreaterThan(0.7);
    expect(pixels.colors).toBeGreaterThan(7);
    const browser = await page.evaluate(async () => {
      const mainPath = '/src/browser/main.ts';
      const snapshotPath = '/src/core/snapshot.ts';
      const { mapState } = await import(mainPath);
      const { canonicalSerialize, stateDigest } = await import(snapshotPath);
      return { state: canonicalSerialize(mapState), digest: stateDigest(mapState) };
    });
    const node = generateMap({ seed });
    expect(browser).toEqual({ state: canonicalSerialize(node), digest: stateDigest(node) });
    if (seed === 12345) {
      await page.screenshot({ path: '/Users/bytedance/.local/state/gsb-local/pokemon-civilazation/reports/m0-map.png', fullPage: true });
    }
    expect(errors).toEqual([]);
  });
}

test('invalid seeds show an explanation instead of a blank map', async ({ page }) => {
  await page.goto('/?seed=invalid');
  await expect(page.getByRole('status')).toContainText('无法生成地图');
  await expect(page.locator('canvas')).toBeHidden();
});
