import { Module } from '@nestjs/common';

import { DailyController } from './daily.controller.js';
import { DailyService } from './daily.service.js';

@Module({
  controllers: [DailyController],
  providers: [DailyService],
})
export class DailyModule {}
