import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  // SWC is needed so emitDecoratorMetadata works for NestJS DI under Vitest;
  // esbuild (Vitest's default) drops it, which leaves parameter-property
  // injections undefined and crashes onApplicationBootstrap hooks.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts', 'test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 240_000,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
