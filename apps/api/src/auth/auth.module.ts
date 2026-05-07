import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AdminBootstrap } from './admin-bootstrap.service.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { ScopeGuard } from './scope.guard.js';
import { SessionStore } from './session.store.js';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionStore,
    AdminBootstrap,
    AuthGuard,
    ScopeGuard,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: ScopeGuard },
  ],
  exports: [AuthService, SessionStore],
})
export class AuthModule {}
