// Shared HEALTHCHECK helper for the Mnela Node containers.
// Hits /health on $PORT (defaults to the per-app convention) and exits 0/1.
// Using node:http avoids shipping wget/curl in the runtime image and keeps
// every container honest about whether the HTTP path actually responds.
import http from 'node:http';

const port = Number(process.env.HEALTHCHECK_PORT || process.env.PORT || 3000);
const host = process.env.HEALTHCHECK_HOST || '127.0.0.1';
const requestPath = process.env.HEALTHCHECK_PATH || '/health';

const req = http.get({ host, port, path: requestPath, timeout: 3000 }, (res) => {
  res.resume();
  process.exit(res.statusCode && res.statusCode < 400 ? 0 : 1);
});
req.on('timeout', () => {
  req.destroy();
  process.exit(1);
});
req.on('error', () => process.exit(1));
