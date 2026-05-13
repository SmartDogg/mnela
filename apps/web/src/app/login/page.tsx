import { redirect } from 'next/navigation';

import { LoginForm } from './login-form';
import { getPrincipal } from '@/lib/api/server';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}): Promise<JSX.Element> {
  const params = await searchParams;
  const principal = await getPrincipal().catch(() => null);
  if (principal) {
    redirect(params.next ?? '/');
  }

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      <div className="hidden lg:flex lg:flex-col lg:justify-between lg:bg-sidebar lg:p-12 lg:text-sidebar-foreground">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className="inline-block h-6 w-6 rounded-full bg-primary" />
          Mnela
        </div>
        <div className="space-y-3 max-w-md">
          <p className="text-3xl font-semibold tracking-tight">A second brain you actually own.</p>
          <p className="text-sm text-muted-foreground">
            Self-hosted, single-tenant, MCP-first. Your conversations, notes, and decisions —
            indexed, searchable, and ready for any AI tool that speaks the protocol.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">v0.0</p>
      </div>
      <div className="flex flex-col items-center justify-center bg-background p-6">
        <LoginForm next={params.next} />
      </div>
    </div>
  );
}
