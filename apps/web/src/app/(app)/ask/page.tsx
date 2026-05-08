'use client';

import { useTranslations } from 'next-intl';

import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function AskPage(): JSX.Element {
  const t = useTranslations('nav');
  return (
    <div>
      <PageHeader
        title={t('ask')}
        subtitle="Chat-style synthesis through server-side Claude (Phase 5/8)."
      />
      <div className="px-8 py-6">
        <Card>
          <CardHeader>
            <CardTitle>AI Smart Mode</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Ask Brain streams answers with inline citations. It depends on the server-side Claude
            orchestrator, which lands in Phase 5.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
