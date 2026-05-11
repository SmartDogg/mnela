import { Injectable, Logger } from '@nestjs/common';
import {
  type WhisperStatusState,
  publishEvent,
  readWhisperStatus,
  writeWhisperStatus,
} from '@mnela/queue';

import { RedisService } from '../redis.service.js';

@Injectable()
export class WhisperStatusService {
  private readonly logger = new Logger(WhisperStatusService.name);

  constructor(private readonly redis: RedisService) {}

  get(): Promise<WhisperStatusState> {
    return readWhisperStatus(this.redis.client);
  }

  async set(state: WhisperStatusState): Promise<void> {
    await writeWhisperStatus(this.redis.client, state);
    const eventPayload: { available: boolean; reason?: string } = { available: state.available };
    if (state.reason) eventPayload.reason = state.reason;
    await publishEvent(this.redis.client, {
      type: 'system.whisper_status_changed',
      payload: eventPayload,
    });
    this.logger.log(
      `whisper status: ${state.available ? 'available' : `unavailable (${state.reason ?? 'unknown'})`}`,
    );
  }
}
