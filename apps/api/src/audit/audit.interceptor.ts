import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditLogRepository, PrismaService } from '@mnela/db';
import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { Observable, firstValueFrom } from 'rxjs';

import type { Principal } from '../auth/types.js';
import { AUDIT_META_KEY, type AuditMeta } from './audit.decorator.js';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogRepository,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<AuditMeta | undefined>(AUDIT_META_KEY, context.getHandler());
    if (!meta) return next.handle();
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<Request>();
    const transactional = meta.transactional !== false;

    return new Observable((subscriber) => {
      const work = async (): Promise<unknown> => {
        const handlerResult = await firstValueFrom(next.handle());
        await this.writeAuditRow(meta, req, handlerResult);
        return handlerResult;
      };

      const promise = transactional ? this.prisma.runInTx(work) : work();
      promise
        .then((value) => {
          subscriber.next(value);
          subscriber.complete();
        })
        .catch((err: unknown) => subscriber.error(err));
    });
  }

  private async writeAuditRow(meta: AuditMeta, req: Request, result: unknown): Promise<void> {
    try {
      const targetId = extractTargetId(meta, req, result);
      const after = serializeAfter(result, meta.redact);
      await this.audit.create({
        action: meta.action,
        actor: formatActor(req.principal),
        targetType: meta.targetType,
        targetId,
        after,
        metadata: {
          method: req.method,
          path: req.originalUrl,
        } as Prisma.InputJsonValue,
      });
    } catch (err) {
      this.logger.error(`failed to write audit row for ${meta.action}: ${(err as Error).message}`);
      throw err;
    }
  }
}

function formatActor(principal: Principal | undefined): string {
  if (!principal) return 'anonymous';
  const label = principal.name ?? principal.id;
  return `${principal.kind}:${label}`;
}

function extractTargetId(meta: AuditMeta, req: Request, result: unknown): string {
  if (meta.targetIdParam) {
    const param = req.params?.[meta.targetIdParam];
    if (typeof param === 'string' && param.length > 0) return param;
  }
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    const directId = r['id'];
    if (typeof directId === 'string' && directId.length > 0) return directId;
    for (const key of ['document', 'entity', 'edge', 'project', 'decision', 'item', 'job']) {
      const nested = r[key];
      if (nested && typeof nested === 'object') {
        const nestedId = (nested as Record<string, unknown>)['id'];
        if (typeof nestedId === 'string' && nestedId.length > 0) return nestedId;
      }
    }
  }
  return 'unknown';
}

function serializeAfter(
  value: unknown,
  redact: readonly string[] | undefined,
): Prisma.InputJsonValue | null {
  if (value === undefined || value === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
  if (redact && redact.length > 0 && json && typeof json === 'object' && !Array.isArray(json)) {
    const obj = json as Record<string, unknown>;
    for (const key of redact) {
      if (key in obj) obj[key] = '[redacted]';
    }
  }
  return json as Prisma.InputJsonValue;
}
