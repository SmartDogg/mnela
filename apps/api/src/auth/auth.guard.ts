import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminUserRepository } from '@mnela/db';
import type { Request } from 'express';

import { AuthService } from './auth.service.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { SessionStore } from './session.store.js';
import type { Principal, TokenScope } from './types.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly admins: AdminUserRepository,
    private readonly sessions: SessionStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const principal = await this.resolvePrincipal(req);
    if (!principal) {
      throw new UnauthorizedException('Authentication required');
    }
    req.principal = principal;
    return true;
  }

  private async resolvePrincipal(req: Request): Promise<Principal | null> {
    const bearer = extractBearerToken(req.headers.authorization);
    if (bearer) {
      const token = await this.auth.validateToken(bearer);
      if (!token) return null;
      return {
        kind: 'token',
        id: token.id,
        scope: token.scope as TokenScope,
        name: token.name,
      };
    }

    const sessionId = req.signedCookies?.['mnela_session'];
    if (typeof sessionId === 'string' && sessionId.length > 0) {
      const session = await this.sessions.get(sessionId);
      if (session) {
        const user = await this.admins.findById(session.adminUserId);
        if (user) {
          return {
            kind: 'admin',
            id: user.id,
            scope: 'admin',
            name: user.username,
          };
        }
      }
    }

    return null;
  }
}

function extractBearerToken(header: string | string[] | undefined): string | null {
  if (!header || Array.isArray(header)) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1];
  return token && token.length > 0 ? token : null;
}
