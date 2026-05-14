/**
 * Optional crash / error reporting. Off by default.
 *
 * When `MNELA_SENTRY_DSN` is set AND `@sentry/node` is installed, we
 * dynamic-import it and forward unhandled errors. Skipping the
 * dependency keeps the slim Docker image truly slim; operators who
 * want Sentry add it themselves:
 *
 *     pnpm add @sentry/node -F @mnela/api -F @mnela/worker \
 *                                -F @mnela/orchestrator -F @mnela/tg-bot
 *
 * and set MNELA_SENTRY_DSN in their .env. See docs/TROUBLESHOOTING.md.
 *
 * `initSentry(serviceName)` is safe to call from every long-running
 * process's main.ts unconditionally — it returns false (and logs
 * nothing) when DSN is empty or the package isn't installed.
 */

interface SentryLike {
  init(opts: Record<string, unknown>): void;
  setTag(key: string, value: string): void;
  captureException(err: unknown): void;
}

export interface InitSentryOptions {
  serviceName: string;
  environment?: string;
  release?: string;
  tracesSampleRate?: number;
}

export async function initSentry(opts: InitSentryOptions): Promise<boolean> {
  const dsn = process.env['MNELA_SENTRY_DSN'];
  if (!dsn) return false;
  let sentry: SentryLike;
  try {
    // Dynamic import keeps @sentry/node a soft dependency. If it isn't
    // in node_modules the require throws and we silently skip — the
    // operator either wants Sentry and installs it, or doesn't.
    sentry = (await import('@sentry/node' as string)) as unknown as SentryLike;
  } catch {
    // Log once via stderr; pino isn't wired up yet at the call site.
    process.stderr.write(
      '[sentry] MNELA_SENTRY_DSN set but @sentry/node is not installed — skipping init\n',
    );
    return false;
  }
  sentry.init({
    dsn,
    environment: opts.environment ?? process.env['NODE_ENV'] ?? 'production',
    release: opts.release ?? process.env['MNELA_VERSION'] ?? undefined,
    tracesSampleRate: opts.tracesSampleRate ?? 0,
    /*
     * Strip PII fields that frequently end up in unhandled errors —
     * Authorization headers, cookie jars, request bodies. The Sentry
     * `beforeSend` hook is the right home for this; we list a small
     * default set, operators with stricter requirements override.
     */
    beforeSend(event: Record<string, unknown>) {
      try {
        const req = (event as { request?: Record<string, unknown> }).request;
        if (req) {
          delete req['data'];
          delete req['cookies'];
          const headers = req['headers'] as Record<string, string> | undefined;
          if (headers) {
            delete headers['authorization'];
            delete headers['Authorization'];
            delete headers['cookie'];
            delete headers['Cookie'];
          }
        }
      } catch {
        /* best-effort scrub */
      }
      return event;
    },
  });
  sentry.setTag('service', opts.serviceName);
  return true;
}
