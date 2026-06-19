'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { AppSidebar } from './app-sidebar.js';
import { Chat } from './chat.js';
import { SidebarProvider, SidebarInset } from './ui/sidebar.js';
import { ChatNavProvider } from './chat-nav-context.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Main chat page component.
 *
 * @param {object} props
 * @param {object|null} props.session - Auth session (null = not logged in)
 * @param {boolean} props.needsSetup - Whether setup is needed
 * @param {string} [props.chatId] - Chat ID from URL (only used for initial mount)
 */
export function ChatPage({ session, needsSetup, chatId }) {
  const [activeChatId, setActiveChatId] = useState(chatId || null);
  const [resolvedChatId, setResolvedChatId] = useState(() => chatId ? null : uuidv4());
  const [initialMessages, setInitialMessages] = useState([]);
  const [workspace, setWorkspace] = useState(null);
  const [chatMode, setChatMode] = useState(null);

  const navigateToChat = useCallback((id) => {
    if (id) {
      window.history.pushState({}, '', `/chat/${id}`);
      setActiveChatId(id);
    } else {
      window.history.pushState({}, '', '/');
      setInitialMessages([]);
      setWorkspace(null);
      setChatMode(null);
      setActiveChatId(null);
      setResolvedChatId(uuidv4());
    }
  }, []);

  // Browser back/forward
  useEffect(() => {
    const onPopState = () => {
      const match = window.location.pathname.match(/^\/chat\/(.+)/);
      if (match) {
        setActiveChatId(match[1]);
      } else {
        setInitialMessages([]);
        setWorkspace(null);
        setChatMode(null);
        setActiveChatId(null);
        setResolvedChatId(uuidv4());
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Load messages and workspace data when activeChatId changes
  useEffect(() => {
    if (activeChatId) {
      fetch(`/chat/${activeChatId}/messages`)
        .then(r => r.json())
        .then(async (dbMessages) => {
          if (dbMessages.length === 0) {
            // Stale chat (e.g. after login with old UUID) — start fresh
            setInitialMessages([]);
            setWorkspace(null);
            setChatMode(null);
            setResolvedChatId(uuidv4());
            window.history.replaceState({}, '', '/');
            return;
          }
          const uiMessages = [];
          for (const msg of dbMessages) {
            let parts;
            try {
              const parsed = JSON.parse(msg.content);
              if (parsed?.type === 'tool-invocation') {
                parts = [parsed];
              } else if (parsed?.type === 'error') {
                // Rehydrate error messages as data-error parts (matches live stream shape)
                parts = [{ type: 'data-error', data: { message: parsed.message } }];
              } else {
                parts = [{ type: 'text', text: msg.content }];
              }
            } catch {
              parts = [{ type: 'text', text: msg.content }];
            }

            // Merge consecutive assistant messages into one (matches streaming layout)
            const prev = uiMessages[uiMessages.length - 1];
            if (prev && prev.role === 'assistant' && msg.role === 'assistant') {
              prev.parts.push(...parts);
              prev.content += '\n' + msg.content;
            } else {
              uiMessages.push({
                id: msg.id,
                role: msg.role,
                content: msg.content,
                parts,
                createdAt: new Date(msg.createdAt),
              });
            }
          }
          setInitialMessages(uiMessages);

          // Load chat data (workspace + chat mode)
          try {
            const r = await fetch(`/chat/${activeChatId}/data`);
            const chat = await r.json();
            setWorkspace(chat?.workspace || null);
            setChatMode(chat?.chatMode || null);
          } catch {
            setWorkspace(null);
            setChatMode(null);
          }

          setResolvedChatId(activeChatId);
        })
        .catch(() => {
          // Messages fetch failed — start fresh rather than leaving stale state
          setInitialMessages([]);
          setWorkspace(null);
          setChatMode(null);
          setResolvedChatId(uuidv4());
        });
    }
  }, [activeChatId]);

  const contextValue = useMemo(
    () => ({ activeChatId: activeChatId || resolvedChatId, navigateToChat }),
    [activeChatId, resolvedChatId, navigateToChat]
  );

  if (needsSetup || !session) {
    return null;
  }

  return (
    <ChatNavProvider value={contextValue}>
      <SidebarProvider>
        <AppSidebar user={session.user} />
        <SidebarInset>
          {resolvedChatId && (
            <Chat
              key={resolvedChatId}
              chatId={resolvedChatId}
              initialMessages={initialMessages}
              workspace={workspace}
              chatMode={chatMode}
              isAdmin={session?.user?.role === 'admin'}
            />
          )}
        </SidebarInset>
      </SidebarProvider>
    </ChatNavProvider>
  );
}
