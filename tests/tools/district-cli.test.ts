import { expect, test } from 'vitest';
import { parseSimulationArgs } from '../../tools/simulate.ts';

test('headless CLI keeps the old default and accepts explicit gameplay 10', () => {
  expect(parseSimulationArgs([])).toEqual({ seeds: 10 });
  expect(parseSimulationArgs(['--seeds', '2'])).toEqual({ seeds: 2 });
  expect(parseSimulationArgs(['--gameplay', '10', '--seeds', '1'])).toEqual({ seeds: 1, gameplayVersion: 10 });
  expect(parseSimulationArgs(['--gameplay', '11', '--seeds', '1'])).toEqual({ seeds: 1, gameplayVersion: 11 });
  expect(() => parseSimulationArgs(['--gameplay', '16'])).toThrow();
  expect(() => parseSimulationArgs(['--gameplay', '10', '--gameplay', '9'])).toThrow();
});
