import { useTranslations } from 'next-intl';

import { PageHeader } from '@/components/page-header';
import { ProjectsList } from './projects-list';

export const metadata = { title: 'Projects' };

export default function ProjectsPage(): JSX.Element {
  return <ProjectsPageInner />;
}

function ProjectsPageInner(): JSX.Element {
  const t = useTranslations('projects');
  return (
    <div>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <ProjectsList />
    </div>
  );
}
