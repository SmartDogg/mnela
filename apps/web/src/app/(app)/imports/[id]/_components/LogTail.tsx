'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { RecordedEvent } from '@/lib/socket/types';

interface LogTailProps {
  events: RecordedEvent[];
}

const TYPE_TONE: Record<string, string> = {
  'job.created': 'text-zinc-300',
  'job.started': 'text-sky-300',
  'job.progress': 'text-zinc-400',
  'job.completed': 'text-emerald-300',
  'job.failed': 'text-red-300',
  'document.created': 'text-zinc-300',
  'document.parsed': 'text-sky-300',
  'document.enriched': 'text-emerald-300',
  'graph.node_added': 'text-indigo-300',
  'graph.edge_added': 'text-fuchsia-300',
  'graph.node_updated': 'text-indigo-200',
};

export function LogTail({ events }: LogTailProps): JSX.Element {
  const t = useTranslations('imports.detail');
  const [autoScroll, setAutoScroll] = useState(true);
  const [paused, setPaused] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Snapshot the buffer when paused so the rendering is stable until resumed.
  const frozenRef = useRef<RecordedEvent[] | null>(null);
  const visible = paused ? (frozenRef.current ?? events) : events;

  useEffect(() => {
    if (paused) {
      frozenRef.current ??= events;
    } else {
      frozenRef.current = null;
    }
  }, [paused, events]);

  useEffect(() => {
    if (!autoScroll || paused) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [autoScroll, paused, visible]);

  return (
    <div className="flex h-full flex-col border-t bg-zinc-950/40">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {t('logs')} · {visible.length}
        </span>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant={paused ? 'default' : 'outline'}
            className="h-6 px-2 text-[10px]"
            onClick={() => setPaused((v) => !v)}
            data-testid="logtail-pause"
          >
            {paused ? t('resumeLog') : t('pauseLog')}
          </Button>
          <Button
            size="sm"
            variant={autoScroll ? 'default' : 'outline'}
            className="h-6 px-2 text-[10px]"
            onClick={() => setAutoScroll((v) => !v)}
            data-testid="logtail-autoscroll"
          >
            {t('autoScroll')}
          </Button>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="scrollbar-thin flex-1 overflow-auto px-4 py-2 font-mono text-[11px] leading-snug"
        data-testid="logtail-list"
      >
        {visible.length === 0 ? (
          <p className="text-muted-foreground">{t('noEvents')}</p>
        ) : (
          visible.map((rec, i) => <LogLine key={`${rec.ts}-${i}`} record={rec} />)
        )}
      </div>
    </div>
  );
}

function LogLine({ record }: { record: RecordedEvent }): JSX.Element {
  const ts = new Date(record.ts);
  const hh = ts.getHours().toString().padStart(2, '0');
  const mm = ts.getMinutes().toString().padStart(2, '0');
  const ss = ts.getSeconds().toString().padStart(2, '0');
  const tone = TYPE_TONE[record.event.type] ?? 'text-zinc-300';
  return (
    <div className="flex gap-2">
      <span className="shrink-0 text-zinc-600 tabular-nums">{`${hh}:${mm}:${ss}`}</span>
      <span className={cn('shrink-0', tone)}>{record.event.type}</span>
      <span className="truncate text-zinc-500">{summarise(record)}</span>
    </div>
  );
}

function summarise(record: RecordedEvent): string {
  const { event } = record;
  switch (event.type) {
    case 'job.progress':
      return `${event.payload.progress}${event.payload.message ? ` · ${event.payload.message}` : ''}`;
    case 'job.failed':
      return event.payload.error;
    case 'document.created':
      return `${event.payload.documentId} · ${event.payload.title}`;
    case 'document.parsed':
      return `${event.payload.documentId} · ${event.payload.chunkCount} chunks`;
    case 'document.enriched':
      return `${event.payload.documentId} · +${event.payload.addedEntities}e/${event.payload.addedEdges}r`;
    case 'graph.node_added':
      return `${event.payload.entity.type}:${event.payload.entity.name}`;
    case 'graph.edge_added':
      return `${event.payload.edge.relationType} ${event.payload.edge.fromId}→${event.payload.edge.toId}`;
    case 'graph.node_updated':
      return event.payload.entityId;
    default:
      return '';
  }
}
