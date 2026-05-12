import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// IPv4-pinned default — see note in src/lib/api/server.ts. On Windows + Node
// 22 `localhost` can resolve to `::1` first and Next.js's server-side rewrite
// proxy then fails with ECONNREFUSED against an IPv4-only upstream.
const apiOrigin = process.env.MNELA_API_ORIGIN ?? 'http://127.0.0.1:3000';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // `@mnela/ui` is ESM and pulls in `react-force-graph-2d` + `d3-force`,
  // which are pure-ESM modules. Listing it here tells Next's compiler to
  // transpile them along with our own code so webpack doesn't trip on the
  // package.json `"type": "module"` / `"exports"` resolution at SSR time.
  transpilePackages: ['@mnela/ui'],
  // Default middleware client-body limit is 10MB. Imports route accepts
  // ZIP archives up to 1GB (apps/api FileInterceptor cap) — without this,
  // /_api/imports truncates the upload mid-stream and the API call dies
  // with ECONNRESET. See apps/api/src/modules/imports/imports.controller.ts.
  experimental: {
    middlewareClientMaxBodySize: '1gb',
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
