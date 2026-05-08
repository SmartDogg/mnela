import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const apiOrigin = process.env.MNELA_API_ORIGIN ?? 'http://localhost:3000';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
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
