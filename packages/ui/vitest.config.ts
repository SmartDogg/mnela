import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  // We don't ship CSS — disable PostCSS discovery so vite doesn't crawl into
  // sibling apps' configs (apps/web carries Tailwind/PostCSS) which can have
  // BOM-tainted package.json files in the workspace.
  css: { postcss: { plugins: [] } },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
