'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { cn } from '@/lib/utils';
import type { LiveImportDocument } from '@/lib/socket/types';

interface FileListProps {
  documents: LiveImportDocument[];
}

const STATUS_DOT: Record<string, string> = {
  raw: 'bg-zinc-500',
  parsed: 'bg-sky-500',
  enriching: 'bg-amber-500',
  enriched: 'bg-emerald-500',
  failed: 'bg-red-500',
};

export function FileList({ documents }: FileListProps): JSX.Element {
  const t = useTranslations('imports.detail');

  if (documents.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-4 py-8 text-xs text-muted-foreground">
        {t('noFiles')}
      </div>
    );
  }

  return (
    <ul className="divide-y" data-testid="import-file-list">
      {documents.map((doc) => (
        <li key={doc.id}>
          <Link
            href={`/documents/${encodeURIComponent(doc.id)}`}
            className="flex items-center gap-3 px-4 py-2 text-sm transition-colors hover:bg-accent/30"
          >
            <span
              aria-label={doc.status}
              className={cn(
                'inline-block h-2 w-2 shrink-0 rounded-full',
                STATUS_DOT[doc.status] ?? 'bg-zinc-500',
              )}
            />
            <span className="flex-1 truncate font-mono text-xs">{doc.title || doc.id}</span>
            <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
              {doc.status}
            </span>
            {typeof doc.chunkCount === 'number' && (
              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                {doc.chunkCount}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
