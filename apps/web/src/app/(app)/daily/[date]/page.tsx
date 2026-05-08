import { useTranslations } from 'next-intl';

import { PageHeader } from '@/components/page-header';
import { ApiError } from '@/lib/api/client';
import { apiServer } from '@/lib/api/server';
import type { DailyNote } from '@/lib/api/types';

import { DailyEditor } from './daily-editor';

export const dynamic = 'force-dynamic';

export default async function DailyPage({
  params,
}: {
  params: Promise<{ date: string }>;
}): Promise<JSX.Element> {
  const { date } = await params;
  let note: DailyNote | null = null;
  try {
    note = await apiServer.get<DailyNote>(`/daily/${encodeURIComponent(date)}`);
  } catch (err) {
    if (err instanceof ApiError && err.status !== 404) throw err;
  }

  return <DailyContent date={date} note={note} />;
}

function DailyContent({ date, note }: { date: string; note: DailyNote | null }): JSX.Element {
  const t = useTranslations('daily');
  return (
    <div>
      <PageHeader title={`${t('title')} · ${date}`} subtitle={t('subtitle')} />
      <div className="px-8 py-6">
        <DailyEditor date={date} initial={note} />
      </div>
    </div>
  );
}
