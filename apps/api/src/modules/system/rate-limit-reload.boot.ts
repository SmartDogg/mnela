import { Injectable, type OnModuleInit } from '@nestjs/common';

import { rateLimitHolder } from './rate-limit.holder.js';
import { ReloadService } from './reload.service.js';

/**
 * Registers a real hot-reload for the api ThrottlerModule. The module
 * itself is bound at NestJS DI-graph construction, but the throttler
 * options accept a `Resolvable<number>` for `limit` — we pass a function
 * that reads from `rateLimitHolder`, which caches the SystemConfig value
 * for 10 s. On `system.service_reload` we invalidate the cache so the
 * very next request sees the new limit. Effective hot-reload without
 * rebuilding the DI graph.
 */
@Injectable()
export class RateLimitReloadBoot implements OnModuleInit {
  constructor(private readonly reload: ReloadService) {}

  onModuleInit(): void {
    this.reload.register('api.throttler', async () => {
      rateLimitHolder.invalidate();
    });
  }
}
