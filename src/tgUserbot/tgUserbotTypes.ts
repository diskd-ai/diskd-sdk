// Domain types for the TG Userbot API.
// These are pure data types only -- no classes, no I/O, no side effects.
// The TG Userbot REST API uses snake_case on the wire; encode/decode happens in tgUserbot.ts.

// -- Channel types --

export type TgChannelStatus = 'new' | 'idle' | 'syncing' | 'error';

export type TgChannel = {
  readonly id: number;
  readonly telegramId: number;
  readonly title: string;
  readonly username?: string;
  readonly isPublic: boolean;
  readonly participantsCount?: number;
  readonly status: TgChannelStatus;
  readonly totalMessages: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type TgChannelResolveResult = {
  readonly telegramId: number;
  readonly title: string;
  readonly username?: string;
  readonly isPublic: boolean;
  readonly participantsCount?: number;
};

// -- Task types --

export type TgTaskStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export type TgTask = {
  readonly taskUuid: string;
  readonly status: TgTaskStatus;
  readonly progressPercentage: number;
  readonly messagesProcessed: number;
  readonly totalMessagesToProcess: number;
  readonly errorMessage?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

// -- Channel operation params and results --

export type TgChannelAddParams = {
  readonly channelIdentifier: string;
  readonly limit?: number;
  readonly forceRecreate?: boolean;
};

export type TgChannelAddAction = 'created' | 'sync_started' | 'already_syncing' | 'recreated';

export type TgChannelAddResult = {
  readonly message: string;
  readonly action: TgChannelAddAction;
  readonly channel: TgChannel;
  readonly task?: TgTask;
};

export type TgChannelSyncParams = {
  readonly telegramId: number;
  readonly limit?: number;
};

export type TgChannelStatusResult = {
  readonly channelStatus: string;
  readonly lastTask?: TgTask;
};

// -- Message types --

export type TgMessage = {
  readonly id: number;
  readonly channelTelegramId: number;
  readonly senderId?: number;
  readonly senderName?: string;
  readonly text?: string;
  readonly date: string;
  readonly replyToMessageId?: number;
  readonly isForward: boolean;
  readonly views?: number;
  readonly createdAt?: string;
};

export type TgMessagesParams = {
  /** Number of messages to return (1-1000, default 100). */
  readonly limit?: number;
  readonly offset?: number;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly searchText?: string;
};

export type TgMessagesResult = {
  readonly totalMessagesInDb: number;
  readonly messages: readonly TgMessage[];
};

// -- Stats types --

export type TgChannelStatsResult = {
  readonly totalMessages: number;
  readonly dateRange?: { readonly earliest: string; readonly latest: string };
};

// -- Task list types --

/**
 * Wire-format map of running tasks keyed by task UUID.
 * Record<string, TgTask> is acceptable here because it represents a
 * server-side keyed map, not a domain object.
 */
export type TgTaskListResult = {
  readonly runningTasks: Record<string, TgTask>;
};

// -- Client interface --

/**
 * TG Userbot REST client organized by namespace.
 *
 * Obtain via `createTgUserbotClient`. The `workspaceId` is bound at creation
 * time and is forwarded as `X-Workspace-Id` on all authenticated endpoints.
 * The `channels.resolve` endpoint is public and does not require auth.
 */
export type TgUserbotClient = {
  readonly channels: {
    /** GET /api/v1/channels/resolve?identifier={identifier} -- resolve a channel by username or invite link (no auth). */
    readonly resolve: (identifier: string) => Promise<TgChannelResolveResult>;
    /** POST /api/v1/channels -- add a channel and start sync. */
    readonly add: (params: TgChannelAddParams) => Promise<TgChannelAddResult>;
    /** POST /api/v1/channels/{channelId}/sync -- trigger a sync for an existing channel. */
    readonly sync: (params: TgChannelSyncParams) => Promise<TgChannelAddResult>;
    /** GET /api/v1/channels -- list all channels for the workspace. */
    readonly list: () => Promise<readonly TgChannel[]>;
    /** GET /api/v1/channels/{channelId}/status -- get current status and last task. */
    readonly getStatus: (channelId: number) => Promise<TgChannelStatusResult>;
    /** GET /api/v1/channels/{channelId}/messages -- fetch messages with optional filters. */
    readonly getMessages: (channelId: number, params?: TgMessagesParams) => Promise<TgMessagesResult>;
    /** GET /api/v1/channels/{channelId}/stats -- get aggregate stats. */
    readonly getStats: (channelId: number) => Promise<TgChannelStatsResult>;
    /** DELETE /api/v1/channels/{channelId} -- delete a channel and all its data. */
    readonly delete: (channelId: number) => Promise<void>;
  };
  readonly tasks: {
    /** GET /api/v1/tasks -- list all running tasks. */
    readonly list: () => Promise<TgTaskListResult>;
    /** DELETE /api/v1/tasks/{taskUuid} -- cancel a running task. */
    readonly cancel: (taskUuid: string) => Promise<void>;
  };
};
