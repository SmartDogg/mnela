import type { NextFunction, Request, Response } from 'express';

import { maintenanceHolder } from '../modules/system/backups/maintenance.holder.js';

/**
 * Express middleware that returns 503 for every request while the api
 * is in maintenance mode (RestoreService running). The few endpoints
 * the UI needs to poll for restore status are bypassed — listed
 * explicitly below — so the browser can detect "done" + redirect.
 *
 * Health endpoints are also bypassed so docker / k8s healthchecks don't
 * mark the container unhealthy and kill it mid-restore.
 */
const BYPASS_PATH_PREFIXES = ['/api/v1/system/health', '/api/v1/admin/backups/restore/status'];

export function maintenanceMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!maintenanceHolder.isActive) {
    next();
    return;
  }
  if (BYPASS_PATH_PREFIXES.some((p) => req.originalUrl.startsWith(p))) {
    next();
    return;
  }
  const status = maintenanceHolder.status();
  res.status(503).json({
    type: 'about:blank',
    title: 'Service Unavailable',
    status: 503,
    detail: status.reason || 'Maintenance in progress',
    instance: req.originalUrl,
    since: status.since,
  });
}
