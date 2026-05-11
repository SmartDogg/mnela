import { Injectable } from '@nestjs/common';
import { type WhisperStatusState, readWhisperStatus } from '@mnela/queue';

import { RedisService } from '../../redis.service.js';

@Injectable()
export class WhisperService {
  constructor(private readonly redis: RedisService) {}

  getStatus(): Promise<WhisperStatusState> {
    return readWhisperStatus(this.redis.client);
  }
}
