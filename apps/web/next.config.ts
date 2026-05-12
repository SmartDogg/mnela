import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const apiOrigin = process.env.MNELA_API_ORIGIN ?? 'http://localhost:3000';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
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
