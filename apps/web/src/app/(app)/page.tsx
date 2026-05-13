import { Boxes, BookOpen, Database, GitBranch, Inbox, Sparkles, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiServer } from '@/lib/api/server';
import { formatBytes } from '@/lib/utils';
import type { ClaudeStatus, JobStats, SystemStats } from '@/lib/api/types';

export const metadata = { title: 'Dashboard' };

async function loadOverview(): Promise<{
  stats: SystemStats | null;
  claude: ClaudeStatus | null;
  jobs: JobStats | null;
}> {
  const [stats, claude, jobs] = await Promise.all([
    apiServer.get<SystemStats>('/system/stats').catch(() => null),
    apiServer.get<ClaudeStatus>('/system/claude-status').catch(() => null),
    apiServer.get<JobStats>('/jobs/stats').catch(() => null),
  ]);
  return { stats, claude, jobs };
}

export default async function DashboardPage(): Promise<JSX.Element> {
  const { stats, claude, jobs } = await loadOverview();
  return <DashboardView stats={stats} claude={claude} jobs={jobs} />;
}

function DashboardView({
  stats,
  claude,
  jobs,
}: {
  stats: SystemStats | null;
  claude: ClaudeStatus | null;
  jobs: JobStats | null;
}): JSX.Element {
  const t = useTranslations('dashboard');

  const cards = [
    { label: t('stats.documents'), value: stats?.documents ?? 0, icon: BookOpen },
    { label: t('stats.projects'), value: stats?.projects ?? 0, icon: Boxes },
    { label: t('stats.decisions'), value: stats?.decisions ?? 0, icon: Inbox },
    { label: t('stats.entities'), value: stats?.entities ?? 0, icon: Sparkles },
    { label: t('stats.edges'), value: stats?.edges ?? 0, icon: GitBranch },
    {
      label: t('stats.dbSize'),
      value: stats?.dbSizeBytes ? formatBytes(stats.dbSizeBytes) : '—',
      icon: Database,
    },
  ];

  return (
    <div className="flex flex-col">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <Button asChild>
            <Link href="/imports/new">
              <Upload className="h-4 w-4" /> {t('actions.import')}
            </Link>
          </Button>
        }
      />

      <div className="grid gap-3 px-8 py-6 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        {cards.map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {label}
              </CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tabular-nums">{value.toLocaleString()}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 px-8 pb-8 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('recent')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">{jobs ? renderJobsLine(jobs) : '—'}</p>
            <div className="flex flex-wrap gap-2 text-xs">
              {jobs &&
                Object.entries(jobs).map(([status, count]) => (
                  <Badge key={status} variant="outline">
                    {status}: {count}
                  </Badge>
                ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('claudeMode.label')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  claude?.available ? 'bg-emerald-400' : 'bg-amber-400'
                }`}
              />
              <span>
                {claude?.available ? t('claudeMode.available') : t('claudeMode.disabled')}
              </span>
            </div>
            {claude?.reason && (
              <p className="mt-2 text-xs text-muted-foreground">{claude.reason}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function renderJobsLine(jobs: JobStats): string {
  const total =
    jobs.queued + jobs.running + jobs.paused + jobs.completed + jobs.failed + jobs.cancelled;
  if (total === 0) return 'No jobs yet.';
  return `${jobs.completed} done · ${jobs.running} running · ${jobs.failed} failed`;
}
