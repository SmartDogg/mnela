'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2, RotateCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiError, api } from '@/lib/api/client';
import type { DecisionSummary, DocumentSummary, Paginated, ProjectDetail } from '@/lib/api/types';

interface ProjectEntity {
  id: string;
  name: string;
  type: string;
  description: string | null;
}

export function ProjectDetailView({ project }: { project: ProjectDetail }): JSX.Element {
  const t = useTranslations('projects');

  const entitiesQuery = useQuery({
    queryKey: ['project', project.slug, 'entities'],
    queryFn: () =>
      api.get<ProjectEntity[]>(`/projects/${encodeURIComponent(project.slug)}/entities`),
  });

  const openQuestionsQuery = useQuery({
    queryKey: ['project', project.slug, 'open-questions'],
    queryFn: () =>
      api.get<string[]>(`/projects/${encodeURIComponent(project.slug)}/open-questions`),
  });

  // API doesn't expose denormalized counts on /projects/:slug — fetch them
  // through the list endpoints with limit=1 and read the .total field. Cheap
  // and avoids drift.
  const documentCountQuery = useQuery({
    queryKey: ['project', project.slug, 'documents-count'],
    queryFn: () =>
      api.get<Paginated<DocumentSummary>>('/documents', {
        query: { projectSlug: project.slug, limit: 1 },
      }),
  });
  const decisionCountQuery = useQuery({
    queryKey: ['project', project.slug, 'decisions-count'],
    queryFn: () =>
      api.get<Paginated<DecisionSummary>>('/decisions', {
        query: { projectSlug: project.slug, limit: 1 },
      }),
  });
  const documentCount = documentCountQuery.data?.total ?? 0;
  const decisionCount = decisionCountQuery.data?.total ?? 0;

  const refreshMutation = useMutation({
    mutationFn: () =>
      api.post<{ jobId: string }>(
        `/projects/${encodeURIComponent(project.slug)}/refresh-context`,
        {},
      ),
    onSuccess: (res) => toast.success(t('refreshStarted', { jobId: res.jobId.slice(0, 8) })),
    onError: (err) => {
      if (err instanceof ApiError && err.status === 503) {
        toast.error(t('refreshUnavailable'));
        return;
      }
      toast.error(err instanceof ApiError ? err.message : 'Failed to refresh');
    },
  });

  return (
    <div>
      <PageHeader
        title={project.name}
        subtitle={project.description ?? project.slug}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
            >
              {refreshMutation.isPending ? <Loader2 className="animate-spin" /> : <RotateCw />}
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
                  <p className="text-sm text-muted-foreground">{t('noContext')}</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="documents">
            <p className="text-sm text-muted-foreground">
              {documentCount} document{documentCount === 1 ? '' : 's'} linked.
            </p>
          </TabsContent>
          <TabsContent value="decisions">
            <p className="text-sm text-muted-foreground">
              {decisionCount} decision{decisionCount === 1 ? '' : 's'}.
            </p>
          </TabsContent>
          <TabsContent value="entities">
            {entitiesQuery.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {entitiesQuery.data && entitiesQuery.data.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('noEntities')}</p>
            )}
            {entitiesQuery.data && entitiesQuery.data.length > 0 && (
              <ul className="space-y-2">
                {entitiesQuery.data.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-center justify-between rounded-md border bg-card px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs uppercase">
                        {e.type}
                      </Badge>
                      <span className="text-sm font-medium">{e.name}</span>
                    </div>
                    {e.description && (
                      <span className="text-xs text-muted-foreground">{e.description}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
          <TabsContent value="questions">
            {openQuestionsQuery.isLoading && (
              <p className="text-sm text-muted-foreground">Loading…</p>
            )}
            {openQuestionsQuery.data && openQuestionsQuery.data.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('noQuestions')}</p>
            )}
            {openQuestionsQuery.data && openQuestionsQuery.data.length > 0 && (
              <ul className="list-disc space-y-1.5 pl-5 text-sm">
                {openQuestionsQuery.data.map((q, idx) => (
                  <li key={idx}>{q}</li>
                ))}
              </ul>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
