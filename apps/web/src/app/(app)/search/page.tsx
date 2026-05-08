import { useTranslations } from 'next-intl';

import { PageHeader } from '@/components/page-header';
import { SearchView } from './search-view';

export const metadata = { title: 'Search' };

export default function SearchPage(): JSX.Element {
  return <SearchPageInner />;
}

function SearchPageInner(): JSX.Element {
  const t = useTranslations('search');
  return (
    <div>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <SearchView />
    </div>
  );
}
