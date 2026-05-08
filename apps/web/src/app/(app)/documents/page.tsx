import { useTranslations } from 'next-intl';

import { PageHeader } from '@/components/page-header';
import { DocumentsList } from './documents-list';

export const metadata = { title: 'Documents' };

export default function DocumentsPage(): JSX.Element {
  return <DocumentsPageInner />;
}

function DocumentsPageInner(): JSX.Element {
  const t = useTranslations('documents');
  return (
    <div>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <DocumentsList />
    </div>
  );
}
