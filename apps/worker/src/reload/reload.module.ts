import { Global, Module } from '@nestjs/common';

import { ReloadService } from './reload.service.js';

@Global()
@Module({
  providers: [ReloadService],
  exports: [ReloadService],
})
export class ReloadModule {}
