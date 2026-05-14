import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [swc.vite()],
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/__tests__/**/*.spec.ts'],
    // Allow `vitest run` to succeed when no test files exist — this app
    // has no unit tests yet (logic is grammY-shaped, covered by the
    // Bucket B Playwright smoke). Vitest's default behaviour returns
    // exit 1 on empty include, which red-lights CI.
    passWithNoTests: true,
  },
});
