import { redirect } from 'next/navigation';

// /decisions was removed in ADR-0052; the per-project Decisions tab on
// /projects/[slug] is now the canonical UI surface. There is no
// cross-project decisions list page — bookmarks land on /projects with
// the Active tab as the closest equivalent.
export default function DecisionsRedirect(): never {
  redirect('/projects?status=active');
}
