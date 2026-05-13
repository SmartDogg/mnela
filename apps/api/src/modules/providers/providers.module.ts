import { Global, Module } from '@nestjs/common';

import { ProvidersController } from './providers.controller.js';
import { ProvidersService } from './providers.service.js';

@Global()
@Module({
  controllers: [ProvidersController],
  providers: [ProvidersService],
  exports: [ProvidersService],
})
export class ProvidersModule {}
