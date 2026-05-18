import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/prisma/migrations/**',
      '**/*.tsbuildinfo',
      '**/next-env.d.ts',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/src/lib/api/schema.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.stylistic,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/test/**', '**/__tests__/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
  {
    // NestJS apps rely on runtime class metadata for DI and decorators;
    // auto-fixing imports to `import type` breaks constructor injection.
    // tg-bot was missing from this list — symptom was "Nest can't resolve
    // dependencies of the ConfigService (?, Function)" at boot in prod
    // (tsc erases type-only imports; @swc-node/register keeps them, so
    // it worked in dev but crashed in the Docker image).
    files: [
      'apps/api/**/*.ts',
      'apps/mcp/**/*.ts',
      'apps/worker/**/*.ts',
      'apps/orchestrator/**/*.ts',
      'apps/tg-bot/**/*.ts',
    ],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  prettierConfig,
);
