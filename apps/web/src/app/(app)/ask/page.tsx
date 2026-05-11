'use client';

import { useState } from 'react';

import { ChatPanel } from './_components/chat-panel';
import { ConversationsSidebar } from './_components/conversations-sidebar';

export default function AskPage(): JSX.Element {
  const [activeId, setActiveId] = useState<string | null>(null);
  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      <ConversationsSidebar
        activeId={activeId}
        onSelect={setActiveId}
        onNew={() => setActiveId(null)}
      />
      <ChatPanel conversationId={activeId} onConversationCreated={(id) => setActiveId(id)} />
    </div>
  );
}
