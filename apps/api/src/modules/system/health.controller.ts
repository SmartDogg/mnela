import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../../auth/public.decorator.js';
import { PrismaService } from '../../prisma.service.js';
import { RedisService } from '../../redis.service.js';

@ApiTags('system')
@Public()
@Controller('system')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get('health')
  @ApiOperation({ summary: 'Liveness + dependency probes (db, redis)' })
  async health(): Promise<{
    status: 'ok' | 'degraded';
    db: boolean;
    redis: boolean;
  }> {
    const [db, redis] = await Promise.all([this.pingDb(), this.redis.ping()]);
    return { status: db && redis ? 'ok' : 'degraded', db, redis };
  }

  private async pingDb(): Promise<boolean> {
    try {
      await this.prisma.client.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
