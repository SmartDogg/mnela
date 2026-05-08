'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';

import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api/client';
import type { ClaudeStatus } from '@/lib/api/types';

export default function AdminClaudePage(): JSX.Element {
  const t = useTranslations('admin.claude');
  const status = useQuery({
    queryKey: ['claude-status'],
    queryFn: () => api.get<ClaudeStatus>('/system/claude-status'),
  });

  return (
    <div>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="px-8 py-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{t('status')}</CardTitle>
            <Badge variant={status.data?.available ? 'success' : 'warning'}>
              {status.data?.available ? t('available') : t('unavailable')}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">{status.data?.message ?? t('phase5')}</p>
            <pre className="rounded-md bg-muted/40 p-3 font-mono text-xs scrollbar-thin">
              {`# Run on the server, then return here:
claude login`}
            </pre>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
