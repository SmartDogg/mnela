import { Injectable, type OnModuleInit } from '@nestjs/common';

import { ReloadService } from './reload.service.js';

/**
 * Registers an honest noop ack for the api-side ThrottlerModule. The
 * `@nestjs/throttler` `ThrottlerModule.forRootAsync(...)` factory runs
 * once at NestJS DI-graph construction; re-running it mid-process would
 * require rebuilding the full app. Until we replace ThrottlerModule with
 * a custom guard that reads `api.rateLimit.*` per request, "Restart
 * Services" cannot actually change the rate limit. Pretending otherwise
 * with a fake ack would be a regression. The noop ack surfaces a clear
 * note in the admin overlay so the operator knows to redeploy.
 */
@Injectable()
export class ThrottlerReloadBoot implements OnModuleInit {
  constructor(private readonly reload: ReloadService) {}

  onModuleInit(): void {
    this.reload.registerNoop(
      'api.throttler',
      'rate-limit binding is fixed at boot; needs OS-level process restart to apply',
    );
  }
}
