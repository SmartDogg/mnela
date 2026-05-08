'use client';

import { useTranslations } from 'next-intl';

import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function AdminBackupPage(): JSX.Element {
  const t = useTranslations('admin.backup');
  return (
    <div>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="px-8 py-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('phase10')}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Snapshot, restore, and scheduled backups land in the deploy phase.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
