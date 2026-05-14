/**
 * Module-scoped singleton holding the api's maintenance flag. The
 * RestoreService flips it to `true` for the duration of a restore;
 * the maintenance middleware (`apps/api/src/middleware/maintenance.ts`)
 * reads it on every request and returns 503 for all non-restore-status
 * endpoints.
 *
 * Why a plain singleton and not a Nest service:
 *   - The middleware needs to read it BEFORE any controller-level DI is
 *     resolved (well before AuthGuard / ThrottlerGuard).
 *   - Restore endpoints themselves bypass the flag (status / done).
 *   - Hard for the flag to "leak" — only RestoreService touches it.
 */
class MaintenanceHolder {
  private active = false;
  private reason = '';
  private since: string | null = null;

  enter(reason: string): void {
    this.active = true;
    this.reason = reason;
    this.since = new Date().toISOString();
  }

  exit(): void {
    this.active = false;
    this.reason = '';
    this.since = null;
  }

  status(): { active: boolean; reason?: string; since?: string } {
    if (!this.active) return { active: false };
    return { active: true, reason: this.reason, since: this.since ?? undefined };
  }

  get isActive(): boolean {
    return this.active;
  }
}

export const maintenanceHolder = new MaintenanceHolder();
