import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/core/**/*.ts', 'src/content/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', 'Date', 'performance'],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the serialized seeded RNG.' },
      ],
      'no-restricted-imports': ['error', {
        patterns: ['node:*', '**/browser/**', '**/app/**', '**/ai/**'],
      }],
    },
  },
];
