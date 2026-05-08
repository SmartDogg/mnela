'use client';

import { useParams } from 'next/navigation';

import { LiveImportView } from './_components/LiveImportView';

export default function ImportDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  return <LiveImportView id={params.id} />;
}
