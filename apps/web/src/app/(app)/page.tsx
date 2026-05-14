import {
  Boxes,
  BookOpen,
  Database,
  GitBranch,
  Inbox,
  MessageSquare,
  Send,
  Sparkles,
  Upload,
} from 'lucide-react';
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
  // First-visit branch: no documents in the brain yet → show three concrete
  // entry points instead of a wall of zero-valued stat cards. We don't gate
  // on `stats === null` (API failure) because the operator would still
  // benefit from seeing the real dashboard chrome to debug the failure.
  if (stats && stats.documents === 0) {
    return <DashboardEmpty />;
  }
  return <DashboardView stats={stats} claude={claude} jobs={jobs} />;
}

function DashboardEmpty(): JSX.Element {
  const t = useTranslations('dashboard');
  const tEmpty = useTranslations('dashboard.empty');
  const ctas = [
    {
      icon: Upload,
      title: tEmpty('upload.title'),
      desc: tEmpty('upload.desc'),
      href: '/imports/new',
      cta: tEmpty('upload.cta'),
    },
    {
      icon: Send,
      title: tEmpty('telegram.title'),
      desc: tEmpty('telegram.desc'),
      href: '/admin/system#telegram',
      cta: tEmpty('telegram.cta'),
    },
    {
      icon: MessageSquare,
      title: tEmpty('dropbox.title'),
      desc: tEmpty('dropbox.desc'),
      href: '/admin/system#ingestion',
      cta: tEmpty('dropbox.cta'),
    },
  ];
  return (
    <div className="flex flex-col">
      <PageHeader title={t('title')} subtitle={tEmpty('subtitle')} />
      <div className="grid gap-4 px-4 py-6 sm:px-8 md:grid-cols-3">
        {ctas.map(({ icon: Icon, title, desc, href, cta }) => (
          <Card key={href} className="flex flex-col">
            <CardHeader className="flex flex-row items-center gap-3 pb-2">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </span>
              <CardTitle className="text-sm">{title}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col justify-between gap-4 text-sm text-muted-foreground">
              <p>{desc}</p>
              <Button asChild size="sm" variant="outline" className="self-start">
                <Link href={href}>{cta}</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
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
            <p className="text-muted-foreground">{jobs ? renderJobsLine(jobs, t) : '—'}</p>
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

function renderJobsLine(
  jobs: JobStats,
  t: (key: string, values?: Record<string, number>) => string,
): string {
  const total =
    jobs.queued + jobs.running + jobs.paused + jobs.completed + jobs.failed + jobs.cancelled;
  if (total === 0) return t('noJobs');
  return t('jobsLine', {
    done: jobs.completed,
    running: jobs.running,
    failed: jobs.failed,
  });
}
