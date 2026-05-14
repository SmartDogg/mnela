import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { GlobalCmdk } from '@/components/global-cmdk';
import { Header } from '@/components/header';
import { Sidebar } from '@/components/sidebar';
import { getPrincipal } from '@/lib/api/server';
import { PrincipalProvider } from '@/lib/auth/principal-context';

export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}): Promise<JSX.Element> {
  const principal = await getPrincipal();
  if (!principal) redirect('/login');

  return (
    <PrincipalProvider value={principal}>
      <div className="flex min-h-screen items-start bg-background">
        <Sidebar className="hidden lg:flex" />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header principal={principal} />
          <main className="flex-1 overflow-x-hidden">{children}</main>
        </div>
        <GlobalCmdk />
      </div>
    </PrincipalProvider>
  );
}
