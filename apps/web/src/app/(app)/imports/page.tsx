import { redirect } from 'next/navigation';

// Imports list has been folded into /activity → Uploads tab as part of the v1
// menu consolidation. /imports/new and /imports/[id] still exist for
// deep-links into a specific import.
export default function ImportsRedirect(): never {
  redirect('/activity?tab=uploads');
}
