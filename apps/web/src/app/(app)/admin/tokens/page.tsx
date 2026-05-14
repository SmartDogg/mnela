import { redirect } from 'next/navigation';

// /admin/tokens was folded into /admin/system as the TokensSection card
// in ADR-0052. Old bookmarks land on the consolidated settings page.
export default function AdminTokensRedirect(): never {
  redirect('/admin/system');
}
