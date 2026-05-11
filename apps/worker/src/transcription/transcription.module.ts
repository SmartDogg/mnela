import { Module } from '@nestjs/common';

import { EnrichmentEnqueueService } from '../shared/enrichment-enqueue.service.js';
import { TranscriptionConsumer } from './transcription.consumer.js';
import { WhisperStatusBoot } from './whisper-status.boot.js';
import { WhisperStatusService } from './whisper-status.service.js';

@Module({
  providers: [
    EnrichmentEnqueueService,
    WhisperStatusService,
    WhisperStatusBoot,
    TranscriptionConsumer,
  ],
  exports: [EnrichmentEnqueueService, WhisperStatusService],
})
export class TranscriptionModule {}
