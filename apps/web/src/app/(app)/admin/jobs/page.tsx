import { redirect } from 'next/navigation';

// /admin/jobs and /jobs both now redirect into /activity → Queue tab after v1
// menu consolidation. Old bookmarks still resolve.
export default function AdminJobsRedirect(): never {
  redirect('/activity?tab=queue');
}
