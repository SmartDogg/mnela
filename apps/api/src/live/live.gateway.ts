import crypto from 'node:crypto';

import { Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { AdminUserRepository } from '@mnela/db';
import { type MnelaEvent, subscribeEvents } from '@mnela/queue';
import { Redis } from 'ioredis';
import type { Server, Socket } from 'socket.io';

import { AuthService } from '../auth/auth.service.js';
import { SessionStore } from '../auth/session.store.js';
import type { Principal, TokenScope } from '../auth/types.js';
import { loadEnv } from '../env.js';

@WebSocketGateway({
  namespace: '/live',
  cors: { origin: true, credentials: true },
})
export class LiveGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(LiveGateway.name);
  private subscriber?: Redis;

  constructor(
    private readonly auth: AuthService,
    private readonly admins: AdminUserRepository,
    private readonly sessions: SessionStore,
  ) {}

  async onModuleInit(): Promise<void> {
    const env = loadEnv();
    this.subscriber = new Redis(env.REDIS_URL, { lazyConnect: true });
    await this.subscriber.connect();
    await subscribeEvents(this.subscriber, (event) => this.fanout(event));
    this.logger.log('subscribed to mnela:events redis pubsub');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscriber && this.subscriber.status !== 'end') {
      await this.subscriber.quit().catch(() => undefined);
    }
  }

  afterInit(): void {
    this.logger.log('socket.io /live namespace ready');
  }

  async handleConnection(client: Socket): Promise<void> {
    const principal = await this.authenticate(client);
    if (!principal) {
      client.emit('error', { reason: 'unauthorized' });
      client.disconnect(true);
      return;
    }
    client.data.principal = principal;
    client.emit('hello', {
      principal: { kind: principal.kind, scope: principal.scope, name: principal.name },
    });
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`client disconnected: ${client.id}`);
  }

  private fanout(event: MnelaEvent): void {
    this.server?.emit(event.type, event.payload);
  }

  private async authenticate(client: Socket): Promise<Principal | null> {
    const token = pickToken(client);
    if (token) {
      const record = await this.auth.validateToken(token);
      if (record) {
        return {
          kind: 'token',
          id: record.id,
          scope: record.scope as TokenScope,
          name: record.name,
        };
      }
    }
    const sessionId = pickSessionCookie(client);
    if (sessionId) {
      const session = await this.sessions.get(sessionId);
      if (session) {
        const user = await this.admins.findById(session.adminUserId);
        if (user) {
          return { kind: 'admin', id: user.id, scope: 'admin', name: user.username };
        }
      }
    }
    return null;
  }
}

function pickToken(client: Socket): string | null {
  const auth = client.handshake.auth as Record<string, unknown> | undefined;
  if (auth && typeof auth['token'] === 'string') return auth['token'];
  const header = client.handshake.headers['authorization'];
  if (typeof header === 'string') {
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1] ?? null;
  }
  return null;
}

function pickSessionCookie(client: Socket): string | null {
  const env = loadEnv();
  const raw = client.handshake.headers['cookie'];
  if (typeof raw !== 'string') return null;
  const parts = raw.split(/;\s*/);
  for (const p of parts) {
    const [name, ...rest] = p.split('=');
    if (name === 'mnela_session') {
      const value = rest.join('=');
      const decoded = decodeURIComponent(value);
      // signed cookies have format: 's:<value>.<sig>'
      if (decoded.startsWith('s:')) {
        return verifySignedCookie(decoded.slice(2), env.COOKIE_SECRET);
      }
      return decoded;
    }
  }
  return null;
}

function verifySignedCookie(payload: string, secret: string): string | null {
  const lastDot = payload.lastIndexOf('.');
  if (lastDot === -1) return null;
  const value = payload.slice(0, lastDot);
  const sig = payload.slice(lastDot + 1);
  const expected = crypto
    .createHmac('sha256', secret)
    .update(value)
    .digest('base64')
    .replace(/=+$/, '');
  try {
    if (sig.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  return value;
}
