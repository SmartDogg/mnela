import { redirect } from 'next/navigation';

import { getPrincipal, getSetupStatus } from '@/lib/api/server';

import { SetupWizard } from './setup-wizard';

export const metadata = { title: 'Setup' };

// The wizard is reachable to anyone *until* first-run is done — it's how
// the very first admin gets created. After bootstrap we don't want a
// stale /setup URL re-exposing the flow to anonymous visitors, but we do
// want the authenticated admin to be able to resume (e.g. after F5).
//   - !bootstrapped               → render wizard (initial install)
//   - bootstrapped + no session   → /login
//   - bootstrapped + token-scope  → /
//   - bootstrapped + admin        → render wizard (continuing setup)
export default async function SetupPage(): Promise<JSX.Element> {
  const status = await getSetupStatus();
  if (status.bootstrapped) {
    const principal = await getPrincipal();
    if (!principal) redirect('/login');
    if (principal.kind !== 'admin') redirect('/');
  }
  return (
    <div className="min-h-screen bg-background">
      <SetupWizard />
    </div>
  );
}
