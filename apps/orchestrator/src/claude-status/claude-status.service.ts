import {
  type ClaudeStatusState,
  publishEvent,
  readClaudeStatus,
  writeClaudeStatus,
} from '@mnela/queue';
import { Injectable, Logger } from '@nestjs/common';

import { RedisService } from '../redis.service.js';

@Injectable()
export class ClaudeStatusService {
  private readonly logger = new Logger(ClaudeStatusService.name);

  constructor(private readonly redis: RedisService) {}

  get(): Promise<ClaudeStatusState> {
    return readClaudeStatus(this.redis.client);
  }

  async set(state: ClaudeStatusState): Promise<void> {
    await writeClaudeStatus(this.redis.client, state);
    const eventPayload: { available: boolean; reason?: string } = { available: state.available };
    if (state.reason) eventPayload.reason = state.reason;
    await publishEvent(this.redis.client, {
      type: 'system.claude_status_changed',
      payload: eventPayload,
    });
    this.logger.log(
      `claude status: ${state.available ? 'available' : `unavailable (${state.reason ?? 'unknown'})`}`,
    );
  }
}
