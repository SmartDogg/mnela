'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { AskSidebar } from './_components/ask-sidebar';
import { ChatPanel } from './_components/chat-panel';

export default function AskPage(): JSX.Element {
  const searchParams = useSearchParams();
  // ?conv=<id> deep-links from Cmd-K and elsewhere. Sync once into local
  // state — afterwards in-page sidebar clicks own the active id.
  const initialConv = searchParams?.get('conv') ?? null;
  const [activeId, setActiveId] = useState<string | null>(initialConv);
  // Only react to URL param changes; local sidebar selections shouldn't
  // ping-pong back through the URL.
  useEffect(() => {
    if (initialConv) setActiveId(initialConv);
  }, [initialConv]);
  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      <AskSidebar
        activeConversationId={activeId}
        onSelectConversation={setActiveId}
        onNewConversation={() => setActiveId(null)}
      />
      <ChatPanel conversationId={activeId} onConversationCreated={(id) => setActiveId(id)} />
    </div>
  );
}
