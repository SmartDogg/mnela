import { notFound } from 'next/navigation';

import { ApiError } from '@/lib/api/client';
import { apiServer } from '@/lib/api/server';
import type { DocumentDetail } from '@/lib/api/types';

import { DocumentDetailView } from './document-detail-view';

export const dynamic = 'force-dynamic';

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<JSX.Element> {
  const { id } = await params;
  let document: DocumentDetail;
  try {
    document = await apiServer.get<DocumentDetail>(`/documents/${encodeURIComponent(id)}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  return <DocumentDetailView document={document} />;
}
