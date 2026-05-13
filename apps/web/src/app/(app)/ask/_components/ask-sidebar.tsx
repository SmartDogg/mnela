'use client';

import { Brain, MessagesSquare } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { cn } from '@/lib/utils';

import { ConversationsSidebar } from './conversations-sidebar';
import { DailySidebar } from './daily-sidebar';

type Tab = 'chats' | 'memory';

/**
 * Two-pane sidebar for /ask: the conversations list and the Memory
 * view (everything fed into the brain via ingest-mode chats plus the
 * legacy daily notes). Replaces the standalone /daily route per
 * ADR-0050 + the 'Pinned/Daily' rename of 2026-05-13.
 */
export function AskSidebar({
  activeConversationId,
  onSelectConversation,
  onNewConversation,
}: {
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
}): JSX.Element {
  const t = useTranslations('ask.sidebar');
  const [tab, setTab] = useState<Tab>('chats');

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-border/60 bg-card/30">
      <div className="flex items-center gap-1 border-b border-border/60 p-1">
        <TabButton
          active={tab === 'chats'}
          icon={<MessagesSquare className="size-3" />}
          label={t('chats')}
          onClick={() => setTab('chats')}
        />
        <TabButton
          active={tab === 'memory'}
          icon={<Brain className="size-3" />}
          label={t('memory')}
          onClick={() => setTab('memory')}
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {tab === 'chats' ? (
          <ConversationsSidebar
            activeId={activeConversationId}
            onSelect={onSelectConversation}
            onNew={onNewConversation}
            chrome="bare"
          />
        ) : (
          <DailySidebar onOpenConversation={onSelectConversation} />
        )}
      </div>
    </aside>
  );
}

function TabButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: JSX.Element;
  label: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex flex-1 items-center justify-center gap-1.5 rounded-sm px-2 py-1 text-[11px] font-medium transition-colors',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
      aria-pressed={active}
    >
      {icon}
      {label}
    </button>
  );
}
