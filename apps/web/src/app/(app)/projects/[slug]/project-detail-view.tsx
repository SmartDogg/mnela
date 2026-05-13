'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, MessageCircle, Network, RotateCw, Sparkles, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useMemo } from 'react';
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
  const td = useTranslations('projects.detail');
  const queryClient = useQueryClient();

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

  const documentsQuery = useQuery({
    queryKey: ['project', project.slug, 'documents'],
    queryFn: () =>
      api.get<Paginated<DocumentSummary>>('/documents', {
        // /documents caps `limit` at 100; pagination would be nice later.
        query: { projectSlug: project.slug, limit: 100 },
      }),
    placeholderData: keepPreviousData,
  });

  const decisionCountQuery = useQuery({
    queryKey: ['project', project.slug, 'decisions-count'],
    queryFn: () =>
      api.get<Paginated<DecisionSummary>>('/decisions', {
        query: { projectSlug: project.slug, limit: 1 },
      }),
  });

  const documentCount = documentsQuery.data?.total ?? 0;
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

  const acceptMutation = useMutation({
    mutationFn: () =>
      api.post<ProjectDetail>('/projects', {
        acceptFromSlug: project.slug,
        name: project.name,
        description: project.description,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['project-suggestions'] });
      toast.success(t('acceptedSuccess'));
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('createFailed')),
  });

  const dismissMutation = useMutation({
    mutationFn: () => api.post(`/projects/${encodeURIComponent(project.slug)}/dismiss`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['project-suggestions'] });
      toast.success(t('dismissedSuccess'));
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('createFailed')),
  });

  const documentsByDay = useMemo(() => {
    const grouped = new Map<string, DocumentSummary[]>();
    for (const doc of documentsQuery.data?.items ?? []) {
      const day = doc.createdAt.slice(0, 10);
      const list = grouped.get(day) ?? [];
      list.push(doc);
      grouped.set(day, list);
    }
    return Array.from(grouped.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [documentsQuery.data]);

  const topEntities = useMemo(() => {
    const stored = project.signatureMetrics?.topEntities;
    if (stored && stored.length > 0) return stored;
    const fromMeta = project.metadata?.topEntityNames;
    if (Array.isArray(fromMeta)) return fromMeta.filter((s): s is string => typeof s === 'string');
    return [];
  }, [project.signatureMetrics, project.metadata]);

  const isSuggested = project.status === 'suggested';

  return (
    <div>
      <PageHeader
        title={project.name}
        subtitle={project.description ?? project.slug}
        actions={
          <>
            {isSuggested ? (
              <>
                <Button onClick={() => acceptMutation.mutate()} disabled={acceptMutation.isPending}>
                  {acceptMutation.isPending ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <CheckCircle2 />
                  )}
                  {t('newPage.accept')}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => dismissMutation.mutate()}
                  disabled={dismissMutation.isPending}
                >
                  <X /> {t('newPage.dismiss')}
                </Button>
              </>
            ) : (
              <>
                <Link href={`/ask?scope=project:${encodeURIComponent(project.slug)}`}>
                  <Button variant="default">
                    <MessageCircle /> {td('askAbout')}
                  </Button>
                </Link>
                <Link href={`/graph?project=${encodeURIComponent(project.slug)}`}>
                  <Button variant="outline">
                    <Network /> {td('graph')}
                  </Button>
                </Link>
                <Button
                  variant="outline"
                  onClick={() => refreshMutation.mutate()}
                  disabled={refreshMutation.isPending}
                >
                  {refreshMutation.isPending ? <Loader2 className="animate-spin" /> : <RotateCw />}
                  {t('refresh')}
                </Button>
              </>
            )}
          </>
        }
      />
      <div className="px-8 py-6 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              {isSuggested && <Sparkles className="h-4 w-4" />}
              {td('summary')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{t(`status.${project.status}`)}</Badge>
              <Badge variant="outline">{t(`source.${project.source}`)}</Badge>
              {project.autoFill && <Badge variant="secondary">auto-fill</Badge>}
            </div>
            {project.contextMd ? (
              <pre className="whitespace-pre-wrap text-sm">{project.contextMd}</pre>
            ) : (
              <p className="text-muted-foreground">{td('summaryFallback')}</p>
            )}
            {topEntities.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-2">
                {topEntities.slice(0, 12).map((e) => (
                  <Badge key={e} variant="secondary" className="text-xs">
                    {e}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Tabs defaultValue="files">
          <TabsList>
            <TabsTrigger value="files">
              {td('files')}
              {documentCount > 0 && (
                <Badge variant="secondary" className="ml-1.5 text-xs">
                  {documentCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="timeline">{td('timeline')}</TabsTrigger>
            <TabsTrigger value="entities">{t('entities')}</TabsTrigger>
            <TabsTrigger value="decisions">
              {t('decisions')}
              {decisionCount > 0 && (
                <Badge variant="secondary" className="ml-1.5 text-xs">
                  {decisionCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="questions">{t('questions')}</TabsTrigger>
          </TabsList>

          <TabsContent value="files">
            <Card>
              <CardContent className="py-3">
                {documentsQuery.isLoading && (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                )}
                {documentsQuery.data && documentsQuery.data.items.length === 0 && (
                  <p className="text-sm text-muted-foreground">No documents linked yet.</p>
                )}
                {documentsQuery.data && documentsQuery.data.items.length > 0 && (
                  <ul className="divide-y">
                    {documentsQuery.data.items.map((doc) => (
                      <li key={doc.id} className="flex items-center justify-between py-2 text-sm">
                        <Link
                          href={`/documents/${doc.id}`}
                          className="flex-1 truncate hover:underline"
                        >
                          {doc.title}
                        </Link>
                        <span className="text-xs text-muted-foreground">
                          {doc.createdAt.slice(0, 10)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="timeline">
            <Card>
              <CardContent className="py-3 space-y-3">
                {documentsByDay.length === 0 && <p className="text-sm text-muted-foreground">—</p>}
                {documentsByDay.map(([day, docs]) => (
                  <div key={day} className="space-y-1">
                    <p className="text-xs font-semibold uppercase text-muted-foreground">{day}</p>
                    <ul className="space-y-1 pl-3">
                      {docs.map((d) => (
                        <li key={d.id} className="text-sm">
                          <Link href={`/documents/${d.id}`} className="hover:underline">
                            {d.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </CardContent>
            </Card>
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

          <TabsContent value="decisions">
            <p className="text-sm text-muted-foreground">
              {decisionCount} decision{decisionCount === 1 ? '' : 's'}.
            </p>
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
