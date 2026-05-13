import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [swc.vite()],
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/__tests__/**/*.spec.ts'],
  },
});
