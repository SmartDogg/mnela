'use client';

import { useState } from 'react';

import { AskSidebar } from './_components/ask-sidebar';
import { ChatPanel } from './_components/chat-panel';

export default function AskPage(): JSX.Element {
  const [activeId, setActiveId] = useState<string | null>(null);
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
