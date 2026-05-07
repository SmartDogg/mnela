import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { SCOPES_KEY } from './scope.decorator.js';
import { type TokenScope, scopeAllows } from './types.js';

@Injectable()
export class ScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<TokenScope[] | undefined>(SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const principal = req.principal;
    if (!principal) {
      throw new ForbiddenException('No principal on request');
    }
    const allowed = required.some((scope) => scopeAllows(principal.scope, scope));
    if (!allowed) {
      throw new ForbiddenException(`Required scope: ${required.join(' or ')}`);
    }
    return true;
  }
}
