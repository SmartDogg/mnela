import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { LiveGateway } from './live.gateway.js';

@Module({
  imports: [AuthModule],
  providers: [LiveGateway],
  exports: [LiveGateway],
})
export class LiveModule {}
