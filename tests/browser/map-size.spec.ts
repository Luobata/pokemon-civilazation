import { expect, test } from '@playwright/test';

const sizes = [
  { option: '24x16', width: 24, height: 16, label: '小地图' },
  { option: '30x20', width: 30, height: 20, label: '标准地图' },
  { option: '40x26', width: 40, height: 26, label: '大地图' },
] as const;

for (const size of sizes) {
  test(`${size.label} applies setup, fit camera, zoom bounds and frame metrics`, async ({ page }) => {
    await page.goto('/?seed=12345');
    await page.locator('#map-size').selectOption(size.option);
    await page.locator('#ai-count').selectOption('1');
    await page.locator('#new-game').click();
    await expect(page.locator('#map-size-label')).toHaveText(`${size.label} · ${size.width} × ${size.height}`);
    const initial = await page.evaluate(async () => {
      const mainPath = '/src/browser/main.ts', cameraPath = '/src/browser/camera.ts';
      const { session, camera, developerAdapter } = await import(mainPath);
      const { fitCamera } = await import(cameraPath);
      const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
      return { map: session.getView().map, camera, expected: fitCamera(session.getView().map, canvas.clientWidth, canvas.clientHeight),
        metrics: developerAdapter.getFrameMetrics(), digest: JSON.stringify(developerAdapter.getState()) };
    });
    expect(initial.map.width).toBe(size.width);
    expect(initial.map.height).toBe(size.height);
    expect(initial.map.tiles).toHaveLength(size.width * size.height);
    expect(initial.camera.x).toBeCloseTo(initial.expected.x, 6);
    expect(initial.camera.y).toBeCloseTo(initial.expected.y, 6);
    expect(initial.camera.zoom).toBeCloseTo(initial.expected.zoom, 6);
    expect(initial.camera.zoom).toBeGreaterThan(0);
    expect(initial.metrics.samples).toBeGreaterThan(0);
    await expect(page.locator('#frame-metrics')).toContainText('p95');

    await page.locator('#map').focus();
    for (let i = 0; i < 30; i++) await page.keyboard.press('+');
    await expect.poll(async () => page.evaluate(async () => {
      const mainPath = '/src/browser/main.ts'; return (await import(mainPath)).camera.zoom;
    })).toBe(4);
    for (let i = 0; i < 40; i++) await page.keyboard.press('-');
    await expect.poll(async () => page.evaluate(async () => {
      const mainPath = '/src/browser/main.ts'; return (await import(mainPath)).camera.zoom;
    })).toBe(.25);
    const finalDigest = await page.evaluate(async () => {
      const mainPath = '/src/browser/main.ts'; return JSON.stringify((await import(mainPath)).developerAdapter.getState());
    });
    expect(finalDigest).toBe(initial.digest);
  });
}
