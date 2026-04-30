'use client';

import { useState, useEffect, useCallback } from 'react';
import { Streamdown } from 'streamdown';
import { PageLayout } from './page-layout.js';
import { BellIcon, SpinnerIcon } from './icons.js';
import { linkSafety } from './message.js';
import { getInboxMessages, markMessageReadAction, markAllMessagesRead } from '../actions.js';

const PAGE_SIZE = 25;

function timeAgo(ts) {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export function MessagesPage({ session }) {
  const [tab, setTab] = useState('inbox'); // 'inbox' | 'all'
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (currentTab) => {
    setLoading(true);
    try {
      const result = await getInboxMessages(PAGE_SIZE, 0, { unreadOnly: currentTab === 'inbox' });
      setMessages(result.messages);
      setHasMore(result.hasMore);
      setOffset(PAGE_SIZE);
    } catch (err) {
      console.error('Failed to load messages:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(tab); }, [tab, load]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const result = await getInboxMessages(PAGE_SIZE, offset, { unreadOnly: tab === 'inbox' });
      setMessages((prev) => [...prev, ...result.messages]);
      setHasMore(result.hasMore);
      setOffset((prev) => prev + PAGE_SIZE);
    } catch (err) {
      console.error('Failed to load more:', err);
    } finally {
      setLoadingMore(false);
    }
  };

  const onMessageClick = async (msg) => {
    if (msg.read) return;
    setMessages((prev) =>
      prev
        .map((m) => (m.id === msg.id ? { ...m, read: 1 } : m))
        .filter((m) => (tab === 'inbox' ? !m.read : true))
    );
    try {
      await markMessageReadAction(msg.id);
    } catch (err) {
      console.error('Failed to mark read:', err);
    }
  };

  const onMarkAllRead = async () => {
    try {
      await markAllMessagesRead();
      if (tab === 'inbox') setMessages([]);
      else setMessages((prev) => prev.map((m) => ({ ...m, read: 1 })));
    } catch (err) {
      console.error('Failed to mark all read:', err);
    }
  };

  const TabButton = ({ value, label }) => {
    const active = tab === value;
    return (
      <button
        onClick={() => setTab(value)}
        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
          active
            ? 'bg-foreground text-background'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground'
        }`}
      >
        {label}
      </button>
    );
  };

  return (
    <PageLayout session={session}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Messages</h1>
        {tab === 'inbox' && messages.length > 0 && (
          <button
            onClick={onMarkAllRead}
            className="px-3 py-1.5 text-sm font-medium rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            Mark all as read
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4">
        <TabButton value="inbox" label="Inbox" />
        <TabButton value="all" label="All" />
      </div>

      {/* List */}
      {loading ? (
        <div className="flex flex-col gap-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-md bg-border/50" />
          ))}
        </div>
      ) : messages.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          {tab === 'inbox' ? 'No unread messages.' : 'No messages yet.'}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {messages.map((m) => (
            <button
              key={m.id}
              onClick={() => onMessageClick(m)}
              className={`flex items-start gap-3 p-4 border border-border rounded-lg text-left transition-colors hover:bg-accent ${
                m.read ? 'opacity-60' : ''
              }`}
            >
              <div className="mt-0.5 shrink-0 text-muted-foreground">
                <BellIcon size={16} />
              </div>
              <div className="flex-1 min-w-0 overflow-hidden">
                <div className="text-sm prose-sm overflow-hidden break-words">
                  <Streamdown mode="static" linkSafety={linkSafety}>{m.content}</Streamdown>
                </div>
                <span className="text-xs text-muted-foreground">
                  {timeAgo(m.createdAt)}
                </span>
              </div>
            </button>
          ))}
          {hasMore && (
            <div className="flex justify-center mt-2">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="inline-flex items-center gap-1.5 rounded-md px-4 py-2 min-h-[44px] text-sm font-medium border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 disabled:pointer-events-none"
              >
                {loadingMore ? (
                  <>
                    <SpinnerIcon size={14} />
                    Loading...
                  </>
                ) : (
                  'Show more'
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </PageLayout>
  );
}
