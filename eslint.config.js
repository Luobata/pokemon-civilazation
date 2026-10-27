import path from 'node:path';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/core/**/*.ts', 'src/content/**/*.ts', 'src/ai/**/*.ts'],
    plugins: {
      boundaries: { rules: {
        'pure-imports': {
          meta: { type: 'problem', schema: [], messages: { forbidden: 'Core/content imports must resolve within src/core or src/content.' } },
          create(context) {
            const roots = ['src/core', 'src/content', ...(context.filename.includes(`${path.sep}src${path.sep}ai${path.sep}`) ? ['src/ai'] : [])].map(root => path.resolve(context.cwd, root) + path.sep);
            function check(node, source) {
              const name = source?.value;
              const resolved = typeof name === 'string' && name.startsWith('.')
                ? path.resolve(path.dirname(context.filename), name) : '';
              if (!roots.some(root => resolved.startsWith(root))) context.report({ node, messageId: 'forbidden' });
            }
            return {
              ImportDeclaration: node => check(node, node.source),
              ExportNamedDeclaration: node => { if (node.source) check(node, node.source); },
              ExportAllDeclaration: node => check(node, node.source),
              ImportExpression: node => check(node, node.source),
              TSImportType: node => check(node, node.argument?.literal ?? node.argument),
              TSImportEqualsDeclaration: node => check(node, node.moduleReference.expression),
              CallExpression: node => { if (node.callee.name === 'require') check(node, node.arguments[0]); },
            };
          },
        },
      } },
    },
    rules: {
      'boundaries/pure-imports': 'error',
      'no-restricted-globals': ['error', 'Date', 'performance'],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the serialized seeded RNG.' },
      ],
    },
  },
];
