import { redirect } from 'next/navigation';

// The queue dashboard now lives at /activity → Queue tab as part of the v1
// menu consolidation. The internal _components/ are still consumed from
// there by relative import.
export default function JobsRedirect(): never {
  redirect('/activity?tab=queue');
}
