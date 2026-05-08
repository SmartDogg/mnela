'use client';

import { useTranslations } from 'next-intl';

import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function GraphPage(): JSX.Element {
  const t = useTranslations('nav');
  return (
    <div>
      <PageHeader
        title={t('graph')}
        subtitle="Cytoscape view across entities and edges (Phase 4)."
      />
      <div className="px-8 py-6">
        <Card>
          <CardHeader>
            <CardTitle>Phase 4</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border border-dashed bg-muted/20 p-12 text-center text-sm text-muted-foreground">
              Live, force-directed graph with hover-evidence, layout switcher, and filters lands in
              Phase 4. The data model is already in place.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
