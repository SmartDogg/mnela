import { notFound } from 'next/navigation';

import { ApiError } from '@/lib/api/client';
import { apiServer } from '@/lib/api/server';
import type { DocumentDetail } from '@/lib/api/types';

import { DocumentDetailView } from './document-detail-view';
import { HighlightBanner } from './highlight-banner';

export const dynamic = 'force-dynamic';

export default async function DocumentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ highlight?: string }>;
}): Promise<JSX.Element> {
  const { id } = await params;
  const { highlight } = await searchParams;
  let document: DocumentDetail;
  try {
    document = await apiServer.get<DocumentDetail>(`/documents/${encodeURIComponent(id)}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  return (
    <>
      {highlight && (
        <HighlightBanner body={document.rawText || document.contentMd} query={highlight} />
      )}
      <DocumentDetailView document={document} />
    </>
  );
}
