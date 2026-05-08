import { notFound } from 'next/navigation';

import { ApiError } from '@/lib/api/client';
import { apiServer } from '@/lib/api/server';
import type { ProjectDetail } from '@/lib/api/types';

import { ProjectDetailView } from './project-detail-view';

export const dynamic = 'force-dynamic';

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<JSX.Element> {
  const { slug } = await params;
  let project: ProjectDetail;
  try {
    project = await apiServer.get<ProjectDetail>(`/projects/${encodeURIComponent(slug)}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
  return <ProjectDetailView project={project} />;
}
