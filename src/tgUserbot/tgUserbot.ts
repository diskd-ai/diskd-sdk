import type { AuthModule } from '../auth/types.js';
import { resolveDiskdGatewayUrl } from '../env/baseUrl.js';
import type {
  TgChannel,
  TgChannelAddParams,
  TgChannelAddResult,
  TgChannelResolveResult,
  TgChannelStatusResult,
  TgChannelStatsResult,
  TgChannelSyncParams,
  TgMessage,
  TgMessagesParams,
  TgMessagesResult,
  TgTask,
  TgTaskListResult,
  TgUserbotClient,
} from './tgUserbotTypes.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type RawObject = { readonly [key: string]: unknown };

const isObject = (value: unknown): value is RawObject =>
  typeof value === 'object' && value !== null;

const str = (obj: RawObject, key: string): string | undefined => {
  const v = obj[key];
  return typeof v === 'string' ? v : undefined;
};

const num = (obj: RawObject, key: string): number | undefined => {
  const v = obj[key];
  return typeof v === 'number' ? v : undefined;
};

const bool = (obj: RawObject, key: string): boolean | undefined => {
  const v = obj[key];
  return typeof v === 'boolean' ? v : undefined;
};

const buildQueryString = (params: Readonly<Record<string, string | number | undefined>>): string => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
  if (entries.length === 0) return '';
  const searchParams = new URLSearchParams();
  for (const [key, value] of entries) {
    searchParams.set(key, String(value));
  }
  return `?${searchParams.toString()}`;
};

// ---------------------------------------------------------------------------
// Response decoders -- explicit snake_case -> camelCase per field
// ---------------------------------------------------------------------------

const decodeTask = (o: unknown): TgTask => {
  if (!isObject(o)) throw new Error('Invalid TG Userbot response: task must be an object');
  return {
    taskUuid: str(o, 'task_uuid') ?? '',
    status: (str(o, 'status') as TgTask['status']) ?? 'running',
    progressPercentage: num(o, 'progress_percentage') ?? 0,
    messagesProcessed: num(o, 'messages_processed') ?? 0,
    totalMessagesToProcess: num(o, 'total_messages_to_process') ?? 0,
    errorMessage: str(o, 'error_message'),
    createdAt: str(o, 'created_at') ?? '',
    updatedAt: str(o, 'updated_at') ?? '',
  };
};

const decodeChannel = (o: unknown): TgChannel => {
  if (!isObject(o)) throw new Error('Invalid TG Userbot response: channel must be an object');
  return {
    id: num(o, 'id') ?? 0,
    telegramId: num(o, 'telegram_id') ?? 0,
    title: str(o, 'title') ?? '',
    username: str(o, 'username'),
    isPublic: bool(o, 'is_public') ?? false,
    participantsCount: num(o, 'participants_count'),
    status: (str(o, 'status') as TgChannel['status']) ?? 'new',
    totalMessages: num(o, 'total_messages') ?? 0,
    createdAt: str(o, 'created_at') ?? '',
    updatedAt: str(o, 'updated_at') ?? '',
  };
};

const decodeChannelResolveResult = (o: unknown): TgChannelResolveResult => {
  if (!isObject(o)) throw new Error('Invalid TG Userbot response: resolve result must be an object');
  return {
    telegramId: num(o, 'telegram_id') ?? 0,
    title: str(o, 'title') ?? '',
    username: str(o, 'username'),
    isPublic: bool(o, 'is_public') ?? false,
    participantsCount: num(o, 'participants_count'),
  };
};

const decodeChannelAddResult = (o: unknown): TgChannelAddResult => {
  if (!isObject(o)) throw new Error('Invalid TG Userbot response: channel add result must be an object');
  const rawTask = o['task'];
  return {
    message: str(o, 'message') ?? '',
    action: (str(o, 'action') as TgChannelAddResult['action']) ?? 'created',
    channel: decodeChannel(o['channel']),
    task: rawTask !== undefined && rawTask !== null ? decodeTask(rawTask) : undefined,
  };
};

const decodeChannelStatusResult = (o: unknown): TgChannelStatusResult => {
  if (!isObject(o)) throw new Error('Invalid TG Userbot response: channel status must be an object');
  const rawLastTask = o['last_task'];
  return {
    channelStatus: str(o, 'channel_status') ?? '',
    lastTask: rawLastTask !== undefined && rawLastTask !== null ? decodeTask(rawLastTask) : undefined,
  };
};

const decodeMessage = (o: unknown): TgMessage => {
  if (!isObject(o)) throw new Error('Invalid TG Userbot response: message must be an object');
  return {
    id: num(o, 'id') ?? 0,
    channelTelegramId: num(o, 'channel_telegram_id') ?? 0,
    senderId: num(o, 'sender_id'),
    senderName: str(o, 'sender_name'),
    text: str(o, 'text'),
    date: str(o, 'date') ?? '',
    replyToMessageId: num(o, 'reply_to_message_id'),
    isForward: bool(o, 'is_forward') ?? false,
    views: num(o, 'views'),
    createdAt: str(o, 'created_at'),
  };
};

const decodeMessagesResult = (o: unknown): TgMessagesResult => {
  if (!isObject(o)) throw new Error('Invalid TG Userbot response: messages result must be an object');
  const rawMessages = o['messages'];
  const messages = Array.isArray(rawMessages) ? rawMessages.map(decodeMessage) : [];
  return {
    totalMessagesInDb: num(o, 'total_messages_in_db') ?? 0,
    messages,
  };
};

const decodeChannelStatsResult = (o: unknown): TgChannelStatsResult => {
  if (!isObject(o)) throw new Error('Invalid TG Userbot response: stats result must be an object');
  const rawDateRange = o['date_range'];
  let dateRange: TgChannelStatsResult['dateRange'];
  if (isObject(rawDateRange)) {
    dateRange = {
      earliest: str(rawDateRange, 'earliest') ?? '',
      latest: str(rawDateRange, 'latest') ?? '',
    };
  }
  return {
    totalMessages: num(o, 'total_messages') ?? 0,
    dateRange,
  };
};

const decodeTaskListResult = (o: unknown): TgTaskListResult => {
  if (!isObject(o)) throw new Error('Invalid TG Userbot response: task list result must be an object');
  const rawRunning = o['running_tasks'];
  const runningTasks: Record<string, TgTask> = {};
  if (isObject(rawRunning)) {
    for (const [uuid, rawTask] of Object.entries(rawRunning)) {
      runningTasks[uuid] = decodeTask(rawTask);
    }
  }
  return { runningTasks };
};

// ---------------------------------------------------------------------------
// Request encoders -- explicit camelCase -> snake_case per field
// ---------------------------------------------------------------------------

type EncodedChannelAddBody = {
  readonly channel_identifier: string;
  readonly limit?: number;
  readonly force_recreate?: boolean;
};

const encodeChannelAddParams = (params: TgChannelAddParams): EncodedChannelAddBody => ({
  channel_identifier: params.channelIdentifier,
  ...(params.limit !== undefined ? { limit: params.limit } : {}),
  ...(params.forceRecreate !== undefined ? { force_recreate: params.forceRecreate } : {}),
});

type EncodedChannelSyncBody = {
  readonly telegram_id: number;
  readonly limit?: number;
};

const encodeChannelSyncParams = (params: TgChannelSyncParams): EncodedChannelSyncBody => ({
  telegram_id: params.telegramId,
  ...(params.limit !== undefined ? { limit: params.limit } : {}),
});

type EncodedMessagesQuery = Readonly<Record<string, string | number | undefined>>;

const encodeMessagesParams = (params: TgMessagesParams): EncodedMessagesQuery => ({
  limit: params.limit,
  offset: params.offset,
  start_date: params.startDate,
  end_date: params.endDate,
  search_text: params.searchText,
});

// ---------------------------------------------------------------------------
// HTTP transport
// ---------------------------------------------------------------------------

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

type FetchOptions = {
  readonly method: HttpMethod;
  readonly url: string;
  readonly authHeaders: Readonly<Record<string, string>>;
  readonly workspaceId?: string;
  readonly body?: unknown;
};

const httpRequest = async <T>(options: FetchOptions): Promise<T> => {
  const headers: Record<string, string> = { ...options.authHeaders };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (options.workspaceId !== undefined) {
    headers['X-Workspace-Id'] = options.workspaceId;
  }

  const response = await fetch(options.url, {
    method: options.method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const errorData = (await response.json()) as unknown;
      if (isObject(errorData)) {
        const err = errorData['error'];
        if (isObject(err) && typeof err['message'] === 'string') {
          message = err['message'];
        } else if (typeof errorData['message'] === 'string') {
          message = errorData['message'];
        } else if (typeof errorData['detail'] === 'string') {
          message = errorData['detail'];
        }
      }
    } catch {
      // Could not parse error body -- use default message
    }
    throw new Error(`TG Userbot request failed (${response.status}): ${message}`);
  }

  if (response.status === 204) {
    return undefined as unknown as T;
  }

  return (await response.json()) as T;
};

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

/**
 * Creates a TG Userbot REST client bound to a given auth module and workspace.
 *
 * The URL defaults to the centralized `DISKD_BASE_URL` gateway with the
 * `/utils/tg-userbot` path prefix.
 *
 * The `workspaceId` is forwarded as `X-Workspace-Id` on all authenticated
 * endpoints. The `channels.resolve` endpoint is public and does not require it.
 *
 * Example:
 * ```ts
 * const tg = createTgUserbotClient({ auth, workspaceId: 'ws_01...' });
 * const channels = await tg.channels.list();
 * ```
 */
export const createTgUserbotClient = (params: {
  readonly auth: AuthModule;
  readonly url?: string;
  readonly workspaceId: string;
}): TgUserbotClient => {
  const baseUrl = (params.url ?? resolveDiskdGatewayUrl('utils/tg-userbot')).replace(/\/+$/, '');

  const getAuthHeaders = async (): Promise<Record<string, string>> => {
    if (params.auth.getRequestHeaders) {
      return params.auth.getRequestHeaders();
    }
    const token = await params.auth.getAccessToken();
    return { Authorization: `Bearer ${token}` };
  };

  const request = async <T>(
    method: HttpMethod,
    path: string,
    opts: {
      readonly withWorkspace?: boolean;
      readonly body?: unknown;
      readonly query?: Readonly<Record<string, string | number | undefined>>;
    } = {},
  ): Promise<T> => {
    const authHeaders = await getAuthHeaders();
    const qs = opts.query ? buildQueryString(opts.query) : '';
    return httpRequest<T>({
      method,
      url: `${baseUrl}${path}${qs}`,
      authHeaders,
      workspaceId: opts.withWorkspace !== false ? params.workspaceId : undefined,
      body: opts.body,
    });
  };

  /** Public request -- no auth headers, no workspace id. */
  const publicRequest = async <T>(
    path: string,
    query?: Readonly<Record<string, string | number | undefined>>,
  ): Promise<T> => {
    const qs = query ? buildQueryString(query) : '';
    return httpRequest<T>({
      method: 'GET',
      url: `${baseUrl}${path}${qs}`,
      authHeaders: {},
    });
  };

  return {
    channels: {
      resolve: async (identifier: string): Promise<TgChannelResolveResult> => {
        const raw = await publicRequest<unknown>('/api/v1/channels/resolve', {
          identifier,
        });
        return decodeChannelResolveResult(raw);
      },

      add: async (addParams: TgChannelAddParams): Promise<TgChannelAddResult> => {
        const raw = await request<unknown>('POST', '/api/v1/channels', {
          withWorkspace: true,
          body: encodeChannelAddParams(addParams),
        });
        return decodeChannelAddResult(raw);
      },

      sync: async (syncParams: TgChannelSyncParams): Promise<TgChannelAddResult> => {
        const raw = await request<unknown>(
          'POST',
          `/api/v1/channels/${syncParams.telegramId}/sync`,
          {
            withWorkspace: true,
            body: encodeChannelSyncParams(syncParams),
          },
        );
        return decodeChannelAddResult(raw);
      },

      list: async (): Promise<readonly TgChannel[]> => {
        const raw = await request<readonly unknown[]>('GET', '/api/v1/channels', {
          withWorkspace: true,
        });
        return raw.map(decodeChannel);
      },

      getStatus: async (channelId: number): Promise<TgChannelStatusResult> => {
        const raw = await request<unknown>(
          'GET',
          `/api/v1/channels/${channelId}/status`,
          { withWorkspace: true },
        );
        return decodeChannelStatusResult(raw);
      },

      getMessages: async (channelId: number, msgParams?: TgMessagesParams): Promise<TgMessagesResult> => {
        const raw = await request<unknown>(
          'GET',
          `/api/v1/channels/${channelId}/messages`,
          {
            withWorkspace: true,
            query: msgParams ? encodeMessagesParams(msgParams) : undefined,
          },
        );
        return decodeMessagesResult(raw);
      },

      getStats: async (channelId: number): Promise<TgChannelStatsResult> => {
        const raw = await request<unknown>(
          'GET',
          `/api/v1/channels/${channelId}/stats`,
          { withWorkspace: true },
        );
        return decodeChannelStatsResult(raw);
      },

      delete: async (channelId: number): Promise<void> => {
        await request<void>(
          'DELETE',
          `/api/v1/channels/${channelId}`,
          { withWorkspace: true },
        );
      },
    },

    tasks: {
      list: async (): Promise<TgTaskListResult> => {
        const raw = await request<unknown>('GET', '/api/v1/tasks', {
          withWorkspace: true,
        });
        return decodeTaskListResult(raw);
      },

      cancel: async (taskUuid: string): Promise<void> => {
        await request<void>(
          'DELETE',
          `/api/v1/tasks/${encodeURIComponent(taskUuid)}`,
          { withWorkspace: true },
        );
      },
    },
  };
};
