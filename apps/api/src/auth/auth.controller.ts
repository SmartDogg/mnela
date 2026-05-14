import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { Audit } from '../audit/audit.decorator.js';
import { loadEnv } from '../env.js';
import { rateLimitHolder } from '../modules/system/rate-limit.holder.js';
import { AuthService } from './auth.service.js';
import { BootstrapDto, CreateTokenDto, LoginDto } from './dto.js';
import { CurrentPrincipal } from './principal.decorator.js';
import { Public } from './public.decorator.js';
import { RequiredScope } from './scope.decorator.js';
import type { Principal } from './types.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Get('setup-status')
  @ApiOperation({
    summary: 'Whether the first admin has been bootstrapped. Drives the /setup redirect.',
  })
  async setupStatus(): Promise<{ bootstrapped: boolean }> {
    return { bootstrapped: await this.auth.hasAnyAdmin() };
  }

  @Public()
  @Post('bootstrap')
  @HttpCode(201)
  // Single-shot first-admin creation. Rate-limited harshly because it's
  // unauthenticated and idempotent-by-nature (returns 403 once an admin
  // exists). Same per-minute window as /auth/login but cheaper since the
  // success path runs exactly once per deployment.
  @Throttle({ default: { limit: () => rateLimitHolder.getLogin(), ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Create the first admin user when the AdminUser table is empty. ' +
      'Returns 403 once any admin exists. On success, sets the session cookie.',
  })
  @ApiResponse({ status: 201, description: 'First admin created, session cookie set' })
  @ApiResponse({ status: 403, description: 'Admin user(s) already exist' })
  async bootstrap(
    @Body() body: BootstrapDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ id: string; username: string }> {
    const env = loadEnv();
    const { sessionId, ttlSeconds, adminUser } = await this.auth.bootstrapFirstAdmin(
      body.username,
      body.password,
    );
    res.cookie('mnela_session', sessionId, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      signed: true,
      sameSite: 'lax',
      maxAge: ttlSeconds * 1000,
      path: '/',
    });
    return { id: adminUser.id, username: adminUser.username };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  // Stricter window than the global throttler — guards against credential
  // stuffing. The numeric limit is resolved per-request from
  // `rateLimitHolder` so /admin/system → `api.rateLimit.login` is
  // hot-reloadable without a process restart (see RateLimitReloadBoot).
  @Throttle({ default: { limit: () => rateLimitHolder.getLogin(), ttl: 60_000 } })
  @ApiOperation({ summary: 'Log in with username + password, sets a session cookie' })
  @ApiResponse({ status: 200, description: 'Login OK, sets HttpOnly signed cookie' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ id: string; username: string }> {
    const env = loadEnv();
    const { sessionId, ttlSeconds, adminUser } = await this.auth.login(
      body.username,
      body.password,
    );
    res.cookie('mnela_session', sessionId, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      signed: true,
      sameSite: 'lax',
      maxAge: ttlSeconds * 1000,
      path: '/',
    });
    return { id: adminUser.id, username: adminUser.username };
  }

  @Post('logout')
  @HttpCode(200)
  @ApiCookieAuth('mnela_session')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Destroy the current session' })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    const sessionId = req.signedCookies?.['mnela_session'];
    if (typeof sessionId === 'string' && sessionId.length > 0) {
      await this.auth.logout(sessionId);
    }
    res.clearCookie('mnela_session', { path: '/' });
    return { ok: true };
  }

  @Get('me')
  @ApiCookieAuth('mnela_session')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Return the current principal (admin session or API token)' })
  me(@CurrentPrincipal() principal: Principal | undefined): Principal {
    if (!principal) throw new UnauthorizedException();
    return principal;
  }

  @Get('tokens')
  @RequiredScope('admin')
  @ApiCookieAuth('mnela_session')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List active API tokens (no plaintext)' })
  async listTokens(): Promise<
    {
      id: string;
      name: string;
      scope: string;
      createdAt: Date;
      lastUsedAt: Date | null;
      expiresAt: Date | null;
    }[]
  > {
    const tokens = await this.auth.listTokens();
    return tokens.map((t) => ({
      id: t.id,
      name: t.name,
      scope: t.scope,
      createdAt: t.createdAt,
      lastUsedAt: t.lastUsedAt,
      expiresAt: t.expiresAt,
    }));
  }

  @Post('tokens')
  @RequiredScope('admin')
  @Audit({ action: 'auth.token.create', targetType: 'AuthToken', redact: ['token'] })
  @ApiCookieAuth('mnela_session')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create a new API token. Plaintext value is returned ONCE.',
  })
  async createToken(@Body() body: CreateTokenDto): Promise<{
    id: string;
    name: string;
    scope: string;
    token: string;
    expiresAt: Date | null;
  }> {
    const { plaintext, record } = await this.auth.createToken(body);
    return {
      id: record.id,
      name: record.name,
      scope: record.scope,
      token: plaintext,
      expiresAt: record.expiresAt,
    };
  }

  @Delete('tokens/:id')
  @RequiredScope('admin')
  @Audit({ action: 'auth.token.revoke', targetType: 'AuthToken', targetIdParam: 'id' })
  @ApiCookieAuth('mnela_session')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke an API token' })
  async revokeToken(@Param('id') id: string): Promise<{ id: string; revokedAt: Date }> {
    const revoked = await this.auth.revokeToken(id);
    return { id: revoked.id, revokedAt: revoked.revokedAt ?? new Date() };
  }
}
