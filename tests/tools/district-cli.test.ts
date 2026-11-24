import { expect, test } from 'vitest';
import { parseSimulationArgs } from '../../tools/simulate.ts';

test('headless CLI keeps default seeds and accepts explicit gameplay 27 only', () => {
  expect(parseSimulationArgs([])).toEqual({ seeds: 10 });
  expect(parseSimulationArgs(['--seeds', '2'])).toEqual({ seeds: 2 });
  expect(parseSimulationArgs(['--gameplay', '27', '--seeds', '1'])).toEqual({ seeds: 1, gameplayVersion: 27 });
  expect(() => parseSimulationArgs(['--gameplay', '10', '--seeds', '1'])).toThrow();
  expect(() => parseSimulationArgs(['--gameplay', '28'])).toThrow();
  expect(() => parseSimulationArgs(['--gameplay', '27', '--gameplay', '27'])).toThrow();
});
