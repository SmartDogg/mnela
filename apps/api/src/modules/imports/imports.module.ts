import { Module } from '@nestjs/common';

import { JobsModule } from '../jobs/jobs.module.js';
import { ImportsController } from './imports.controller.js';
import { ImportsService } from './imports.service.js';

@Module({
  imports: [JobsModule],
  controllers: [ImportsController],
  providers: [ImportsService],
})
export class ImportsModule {}
