import { redirect } from 'next/navigation';

// /admin/jobs has been folded into the redesigned /jobs page (queue live state
// + failed + collapsible stats — see Phase 6 notes). Keep this redirect so old
// bookmarks and inbound links continue to work.
export default function AdminJobsRedirect(): never {
  redirect('/jobs');
}
