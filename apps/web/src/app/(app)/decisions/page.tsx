import { useTranslations } from 'next-intl';

import { PageHeader } from '@/components/page-header';
import { DecisionsList } from './decisions-list';

export const metadata = { title: 'Decisions' };

export default function DecisionsPage(): JSX.Element {
  return <DecisionsPageInner />;
}

function DecisionsPageInner(): JSX.Element {
  const t = useTranslations('decisions');
  return (
    <div>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <DecisionsList />
    </div>
  );
}
