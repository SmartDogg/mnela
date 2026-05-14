import { redirect } from 'next/navigation';

// /admin/claude was folded into /admin/system as the ClaudeStatusBlock
// inside the AI Providers card in ADR-0052.
export default function AdminClaudeRedirect(): never {
  redirect('/admin/system');
}
