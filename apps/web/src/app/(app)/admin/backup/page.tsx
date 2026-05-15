import { redirect } from 'next/navigation';

// /admin/backup was a Phase-10 placeholder card; deleted in ADR-0052.
// Storage stats live in /admin/system → Storage. Backup CLI scripts are
// tracked in docs/dev/PLAN.md Phase 10.
export default function AdminBackupRedirect(): never {
  redirect('/admin/system');
}
