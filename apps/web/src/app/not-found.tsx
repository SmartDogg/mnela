import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { Button } from '@/components/ui/button';

export default function NotFound(): JSX.Element {
  const t = useTranslations('notFound');
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
        {t('code')}
      </p>
      <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      <Button asChild>
        <Link href="/">{t('backToDashboard')}</Link>
      </Button>
    </div>
  );
}
