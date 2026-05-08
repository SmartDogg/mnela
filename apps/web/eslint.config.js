import rootConfig from '../../eslint.config.js';

export default [
  ...rootConfig,
  {
    ignores: [
      '.next/**',
      'next-env.d.ts',
      'src/lib/api/schema.ts',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    },
  },
];
