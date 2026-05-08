'use client';

import { useTranslations } from 'next-intl';

import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ProjectDetail } from '@/lib/api/types';

export function ProjectDetailView({ project }: { project: ProjectDetail }): JSX.Element {
  const t = useTranslations('projects');
  return (
    <div>
      <PageHeader
        title={project.name}
        subtitle={project.description ?? project.slug}
        actions={
          <>
            <Button variant="outline" disabled>
              {t('refresh')}
            </Button>
          </>
        }
      />
      <div className="px-8 py-6">
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">{t('context')}</TabsTrigger>
            <TabsTrigger value="documents">{t('documents')}</TabsTrigger>
            <TabsTrigger value="decisions">{t('decisions')}</TabsTrigger>
            <TabsTrigger value="entities">{t('entities')}</TabsTrigger>
            <TabsTrigger value="questions">{t('questions')}</TabsTrigger>
          </TabsList>
          <TabsContent value="overview">
            <Card>
              <CardHeader>
                <CardTitle>{t('context')}</CardTitle>
              </CardHeader>
              <CardContent>
                {project.contextMd ? (
                  <pre className="whitespace-pre-wrap text-sm">{project.contextMd}</pre>
                ) : (
                  <p className="text-sm text-muted-foreground">No context yet.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="documents">
            <p className="text-sm text-muted-foreground">
              {project.documentCount} document{project.documentCount === 1 ? '' : 's'} linked.
            </p>
          </TabsContent>
          <TabsContent value="decisions">
            <p className="text-sm text-muted-foreground">
              {project.decisionCount} decision{project.decisionCount === 1 ? '' : 's'}.
            </p>
          </TabsContent>
          <TabsContent value="entities">
            <p className="text-sm text-muted-foreground">Mini-graph appears in Phase 4.</p>
          </TabsContent>
          <TabsContent value="questions">
            <p className="text-sm text-muted-foreground">Open questions surface in Phase 7.</p>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
