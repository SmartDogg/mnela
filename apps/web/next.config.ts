import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// IPv4-pinned default — see note in src/lib/api/server.ts. On Windows + Node
// 22 `localhost` can resolve to `::1` first and Next.js's server-side rewrite
// proxy then fails with ECONNREFUSED against an IPv4-only upstream.
const apiOrigin = process.env.MNELA_API_ORIGIN ?? 'http://127.0.0.1:3000';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Standalone output: bundles only what's needed to run `node server.js`
  // into `.next/standalone/`. The prod Dockerfile copies that into a
  // minimal node:22-slim runtime instead of dragging the entire workspace
  // along. `outputFileTracingRoot` reaches past `apps/web` so pnpm-linked
  // workspace packages (@mnela/shared-types, @mnela/ui) get traced too.
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../../'),
  // `@mnela/ui` is ESM and pulls in `react-force-graph-2d` + `d3-force`,
  // which are pure-ESM modules. Listing it here tells Next's compiler to
  // transpile them along with our own code so webpack doesn't trip on the
  // package.json `"type": "module"` / `"exports"` resolution at SSR time.
  transpilePackages: ['@mnela/ui'],
  // Next's middleware rewrites buffer the request body, so /_api/imports
  // truncates the upload mid-stream when this limit is below the file
  // size and the API call dies with `socket hang up`/`ECONNRESET`. We
  // ceiling at 50 GiB to match the Multer transport ceiling on the API
  // side (apps/api/src/modules/imports/upload.config.ts); the *real*
  // enforced limit lives in SystemConfig `imports.maxBytes` (typed
  // registry, editable in /admin/system, default 5 GiB, no hard cap).
  // ADR-0048 — when this gets uncomfortable (multi-GB exports), the
  // /imports POST should bypass Next entirely and fetch the apps/api
  // origin directly from the browser.
  experimental: {
    middlewareClientMaxBodySize: '50gb',
  },
  async rewrites() {
    return [
      {
        source: '/_api/:path*',
        destination: `${apiOrigin}/api/v1/:path*`,
      },
      {
        source: '/_api-docs-json',
        destination: `${apiOrigin}/api/docs-json`,
      },
    ];
  },
};

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withNextIntl(config);
