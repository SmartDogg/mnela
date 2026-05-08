import { Module } from '@nestjs/common';

import { AuthMiddleware } from './auth.middleware.js';
import { AuthService } from './auth.service.js';

@Module({
  providers: [AuthService, AuthMiddleware],
  exports: [AuthService, AuthMiddleware],
})
export class AuthModule {}
