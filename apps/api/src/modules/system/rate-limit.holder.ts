import { readRegistryValue } from '@mnela/core';
import type { SystemConfigRepository } from '@mnela/db';

/**
 * Module-scoped singleton that resolves `api.rateLimit.*` for the
 * NestJS ThrottlerModule. The `Resolvable<number>` machinery in
 * `@nestjs/throttler` (`ThrottlerOptions.limit: number | ((ctx) =>
 * Promise<number>)`) lets us pass a function per-throttler; that
 * function is invoked **per request**, so live registry overrides
 * take effect without rebuilding the DI graph.
 *
 * - In-memory cache for 10 s so we don't hit Postgres on every
 *   inbound request — a single warm reader is more than enough.
 * - `invalidate()` is called by `RateLimitReloadBoot` on the
 *   `system.service_reload` event so changes from /admin/system
 *   apply instantly instead of waiting out the TTL.
 * - `bind()` is called once from the ThrottlerModule factory in
 *   AppModule.imports so the holder has a repository to read from.
 *
 * The holder is a plain class (not a Nest provider) because the
 * `@Throttle()` decorator on /auth/login needs to reference the
 * same instance at class-definition time — DI lookup at decorator
 * evaluation is awkward; one shared module-level singleton is
 * simpler and just as testable.
 */
class RateLimitHolder {
  private cache: { global: number; login: number; fetchedAt: number } | null = null;
  private repo: SystemConfigRepository | null = null;
  private static readonly CACHE_TTL_MS = 10_000;

  bind(repo: SystemConfigRepository): void {
    this.repo = repo;
  }

  invalidate(): void {
    this.cache = null;
  }

  async getGlobal(): Promise<number> {
    return (await this.read()).global;
  }

  async getLogin(): Promise<number> {
    return (await this.read()).login;
  }

  private async read(): Promise<{ global: number; login: number; fetchedAt: number }> {
    const now = Date.now();
    if (this.cache && now - this.cache.fetchedAt < RateLimitHolder.CACHE_TTL_MS) {
      return this.cache;
    }
    if (!this.repo) {
      // Pre-bind path: a request landed before AppModule's factory ran.
      // Use the registry defaults so the throttler still applies a
      // sane limit during the bootstrap race window.
      return { global: 100, login: 10, fetchedAt: 0 };
    }
    const [global, login] = await Promise.all([
      readRegistryValue<number>(this.repo, 'api.rateLimit.global'),
      readRegistryValue<number>(this.repo, 'api.rateLimit.login'),
    ]);
    this.cache = { global, login, fetchedAt: now };
    return this.cache;
  }
}

export const rateLimitHolder = new RateLimitHolder();
