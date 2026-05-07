import { SetMetadata } from '@nestjs/common';

export const AUDIT_META_KEY = Symbol('auditMeta');

export interface AuditMeta {
  /**
   * Logical action name, e.g. "document.create", "auth.token.create".
   * Mirrors the {action} column in the AuditLog table.
   */
  action: string;
  /**
   * Domain object type touched by this handler, e.g. "Document", "AuthToken".
   * Mirrors the {targetType} column in the AuditLog table.
   */
  targetType: string;
  /**
   * Optional URL param name to use as the target id. Falls back to result.id
   * if the handler returns an object with an `id` string field.
   */
  targetIdParam?: string;
  /**
   * Keys to strip from the captured `after` payload before persisting.
   * Use for plaintext secrets (e.g. token values returned only once).
   */
  redact?: readonly string[];
  /**
   * Whether to wrap the handler in a database transaction. Default true.
   * Set to false for mutations that should NOT roll back when the audit
   * write fails (rare; usually you want true).
   */
  transactional?: boolean;
}

export const Audit = (meta: AuditMeta): MethodDecorator => SetMetadata(AUDIT_META_KEY, meta);
