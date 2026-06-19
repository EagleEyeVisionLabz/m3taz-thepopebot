import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('user'),
  firstName: text('first_name'),
  lastName: text('last_name'),
  nickname: text('nickname'),
  subscribedToSystemMessages: integer('subscribed_to_system_messages').notNull().default(1),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const chats = sqliteTable('chats', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  title: text('title').notNull().default('New Chat'),
  starred: integer('starred').notNull().default(0),
  chatMode: text('chat_mode').notNull().default('agent'),
  codeWorkspaceId: text('code_workspace_id'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    chatId: text('chat_id'),
    userId: text('user_id').notNull(),
    role: text('role').notNull(),
    content: text('content').notNull(),
    payload: text('payload'),
    read: integer('read').notNull().default(0),
    deliveredAt: integer('delivered_at'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    inboxLookup: index('messages_inbox_lookup').on(t.userId, t.read, t.createdAt),
  })
);

export const codeWorkspaces = sqliteTable('code_workspaces', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  containerName: text('container_name').unique(),
  repo: text('repo'),
  branch: text('branch'),
  featureBranch: text('feature_branch'),
  title: text('title').notNull().default('Code Workspace'),
  lastInteractiveCommit: text('last_interactive_commit'),
  codingAgent: text('coding_agent'),
  scope: text('scope'),
  starred: integer('starred').notNull().default(0),
  hasChanges: integer('has_changes').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const clusters = sqliteTable('clusters', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull().default('New Cluster'),
  systemPrompt: text('system_prompt').notNull().default(''),
  folders: text('folders'),
  enabled: integer('enabled').notNull().default(0),
  starred: integer('starred').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const clusterRoles = sqliteTable('cluster_roles', {
  id: text('id').primaryKey(),
  clusterId: text('cluster_id').notNull(),
  roleName: text('role_name').notNull(),
  role: text('role').notNull().default(''),
  prompt: text('prompt').notNull().default('Execute your role.'),
  triggerConfig: text('trigger_config'),
  maxConcurrency: integer('max_concurrency').notNull().default(1),
  cleanupWorkerDir: integer('cleanup_worker_dir').notNull().default(0),
  planMode: integer('plan_mode').notNull().default(0),
  folders: text('folders'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const settings = sqliteTable(
  'settings',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    key: text('key').notNull(),
    value: text('value').notNull(),
    createdBy: text('created_by'),
    lastUsedAt: integer('last_used_at'),
    // Indexed SHA-256 hash of an API key (for type 'api_key'/'agent_job_api_key').
    // Lets verifyApiKey() do a single indexed lookup instead of a full scan +
    // JSON.parse loop. Nullable: legacy rows fall back to the hash inside `value`.
    keyHash: text('key_hash'),
    // Owning user/job for scoped rows (e.g. the user an agent_job_api_key was
    // issued for, or the owner of an agent_job_secret). Nullable: admin/global
    // rows created without an owner remain readable by any agent job.
    ownerId: text('owner_id'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    keyHashLookup: index('settings_key_hash_lookup').on(t.keyHash),
  })
);

export const userChannels = sqliteTable(
  'user_channels',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    channel: text('channel').notNull(),
    channelChatId: text('channel_chat_id'),
    code: text('code'),
    codeExpiresAt: integer('code_expires_at'),
    // Failed /verify attempts against the current pending code. Reset on each
    // re-issue; once it crosses the threshold the code is invalidated.
    codeAttempts: integer('code_attempts').notNull().default(0),
    verifiedAt: integer('verified_at'),
    activeThreadId: text('active_thread_id'),
    systemMessagesEnabled: integer('system_messages_enabled').notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    userChannelUnique: uniqueIndex('user_channels_user_channel_unique').on(t.userId, t.channel),
    channelChatIdUnique: uniqueIndex('user_channels_channel_chat_id_unique').on(t.channel, t.channelChatId),
    codeUnique: uniqueIndex('user_channels_code_unique').on(t.code),
  })
);
