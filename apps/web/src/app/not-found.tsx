import Link from 'next/link';

import { Button } from '@/components/ui/button';

export default function NotFound(): JSX.Element {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">404</p>
      <h1 className="text-3xl font-semibold tracking-tight">Not found</h1>
      <p className="text-sm text-muted-foreground">
        The page you were looking for doesn&apos;t exist (or never did).
      </p>
      <Button asChild>
        <Link href="/">Back to dashboard</Link>
      </Button>
    </div>
  );
}
