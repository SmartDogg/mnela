import { CloudUpload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { DocumentsList } from './documents-list';

export const metadata = { title: 'Documents' };

export default function DocumentsPage(): JSX.Element {
  return <DocumentsPageInner />;
}

function DocumentsPageInner(): JSX.Element {
  const t = useTranslations('documents');
  return (
    <div>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <Button asChild variant="outline">
            <Link href="/activity">
              <CloudUpload className="h-4 w-4" />
              {t('openImports')}
            </Link>
          </Button>
        }
      />
      <DocumentsList />
    </div>
  );
}
