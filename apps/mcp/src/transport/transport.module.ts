import { Module } from '@nestjs/common';

import { ToolsModule } from '../tools/tools.module.js';
import { TransportController } from './transport.controller.js';

@Module({
  imports: [ToolsModule],
  controllers: [TransportController],
})
export class TransportModule {}
