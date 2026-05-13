import { useTranslations } from 'next-intl';

import { PageHeader } from '@/components/page-header';

import { NewProjectClient } from './new-project-client';

export const metadata = { title: 'New project' };

export default function NewProjectPage(): JSX.Element {
  return <NewProjectInner />;
}

function NewProjectInner(): JSX.Element {
  const t = useTranslations('projects.newPage');
  return (
    <div>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <NewProjectClient />
    </div>
  );
}
