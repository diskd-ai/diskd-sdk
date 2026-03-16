import type { AuthModule } from '../auth/types.js';
import { resolveDiskdGatewayUrl } from '../env/baseUrl.js';
import type {
  AgentHubClient,
  AgentHubInvokeParams,
  AgentInfo,
  BillingAliasesResult,
  SupportedModelsResult,
} from './agentHubTypes.js';
import { StreamProtocolFetcher } from './StreamProtocolFetcher.js';

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

const bool = (obj: RawObject, key: string): boolean | undefined => {
  const v = obj[key];
  return typeof v === 'boolean' ? v : undefined;
};

const strArray = (obj: RawObject, key: string): readonly string[] | undefined => {
  const v = obj[key];
  if (!Array.isArray(v)) return undefined;
  return v.filter((item): item is string => typeof item === 'string');
};

const buildQueryString = (
  params: Readonly<Record<string, string | number | undefined>>
): string => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
  if (entries.length === 0) return '';
  const searchParams = new URLSearchParams();
  for (const [key, value] of entries) {
    searchParams.set(key, String(value));
  }
  return `?${searchParams.toString()}`;
};

// ---------------------------------------------------------------------------
// Response decoders
// ---------------------------------------------------------------------------

const decodeAgentInfo = (o: unknown): AgentInfo => {
  if (!isObject(o)) throw new Error('Invalid Agent Hub response: agent info must be an object');
  return {
    id: str(o, 'id') ?? '',
    displayName: str(o, 'displayName') ?? str(o, 'display_name') ?? '',
  };
};

// ---------------------------------------------------------------------------
// HTTP transport (for non-streaming endpoints)
// ---------------------------------------------------------------------------

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

type FetchOptions = {
  readonly method: HttpMethod;
  readonly url: string;
  readonly authHeaders: Readonly<Record<string, string>>;
  readonly workspaceId: string;
  readonly body?: unknown;
};

const httpRequest = async <T>(options: FetchOptions): Promise<T> => {
  const headers: Record<string, string> = {
    ...options.authHeaders,
    'X-Workspace-Id': options.workspaceId,
  };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
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
        const err = errorData.error;
        if (isObject(err) && typeof err.message === 'string') {
          message = err.message;
        } else if (typeof errorData.message === 'string') {
          message = errorData.message;
        }
      }
    } catch {
      // Could not parse error body -- use default message
    }
    throw new Error(`Agent Hub request failed (${response.status}): ${message}`);
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
 * Creates an Agent Hub client bound to a given auth module and workspace.
 *
 * The URL defaults to the centralized `DISKD_BASE_URL` gateway with the
 * `/os/agents` path prefix.
 *
 * The `invoke` method returns a `StreamProtocolStream` for fluent event handling
 * via `StreamProtocolHandler`:
 *
 * ```ts
 * const hub = createAgentHubClient({ auth, workspaceId: 'ws_01...' });
 * const handler = new StreamProtocolHandler()
 *   .on('response.output_text.delta', (e) => process.stdout.write(e.delta))
 *   .on('response.completed', () => console.log('done'));
 *
 * const stream = await hub.invoke({ agentName: 'assistant', query: 'Hello' });
 * stream.map((event) => handler.handle(event))
 *   .stop(() => console.log('closed'))
 *   .catch((err) => console.error(err));
 * ```
 */
export const createAgentHubClient = (params: {
  readonly auth: AuthModule;
  readonly url?: string;
  readonly workspaceId?: string;
}): AgentHubClient => {
  const baseUrl = (params.url ?? resolveDiskdGatewayUrl('os/agents')).replace(/\/+$/, '');

  const resolveWorkspaceId = async (): Promise<string> =>
    params.workspaceId ?? (await params.auth.getWorkspaceId());

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
      readonly body?: unknown;
      readonly query?: Readonly<Record<string, string | number | undefined>>;
    } = {}
  ): Promise<T> => {
    const authHeaders = await getAuthHeaders();
    const workspaceId = await resolveWorkspaceId();
    const qs = opts.query ? buildQueryString(opts.query) : '';
    return httpRequest<T>({
      method,
      url: `${baseUrl}${path}${qs}`,
      authHeaders,
      workspaceId,
      body: opts.body,
    });
  };

  return {
    invoke: async (invokeParams: AgentHubInvokeParams) => {
      const authHeaders = await getAuthHeaders();
      const workspaceId = await resolveWorkspaceId();

      // Auto-inject workspaceId into context.user from auth token claims
      const user = invokeParams.context?.user;
      const enrichedContext: AgentHubInvokeParams['context'] = {
        ...invokeParams.context,
        user: {
          id: user?.id ?? workspaceId,
          name: user?.name,
          email: user?.email,
          workspaceId: user?.workspaceId ?? workspaceId,
        },
      };

      return StreamProtocolFetcher.fetchStream(`${baseUrl}/invoke`, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'X-Workspace-Id': workspaceId,
        },
        body: { ...invokeParams, context: enrichedContext },
      });
    },

    agents: {
      list: async (): Promise<readonly AgentInfo[]> => {
        const raw = await request<readonly unknown[]>('GET', '/supported-agents');
        return Array.isArray(raw) ? raw.map(decodeAgentInfo) : [];
      },

      getSupportedModels: async (agentId: string): Promise<SupportedModelsResult> => {
        const raw = await request<RawObject>('GET', '/supported-models', {
          query: { agent: agentId },
        });
        const modelsRaw = raw.models;
        if (!Array.isArray(modelsRaw)) return { models: [] };
        return {
          models: modelsRaw.map((m: unknown) => {
            if (!isObject(m))
              throw new Error('Invalid Agent Hub response: model info must be an object');
            return {
              provider: str(m, 'provider') ?? '',
              model: str(m, 'model') ?? '',
              displayName: str(m, 'displayName') ?? str(m, 'display_name') ?? '',
              description: str(m, 'description') ?? '',
              supportedTypes: strArray(m, 'supportedTypes') ?? strArray(m, 'supported_types'),
              isStreamModel: bool(m, 'isStreamModel') ?? bool(m, 'is_stream_model'),
            };
          }),
        };
      },
    },

    billing: {
      getAliases: async (): Promise<BillingAliasesResult> => {
        const raw = await request<RawObject>('GET', '/billing-aliases');

        const modelsRaw = raw.models;
        const providersRaw = raw.providers;
        const agentsRaw = raw.agents;

        const models = Array.isArray(modelsRaw)
          ? modelsRaw.map((m: unknown) => {
              if (!isObject(m))
                throw new Error(
                  'Invalid Agent Hub response: billing alias model must be an object'
                );
              return {
                billingAlias: str(m, 'billingAlias') ?? str(m, 'billing_alias') ?? '',
                provider: str(m, 'provider') ?? '',
                model: str(m, 'model') ?? '',
                displayName: str(m, 'displayName') ?? str(m, 'display_name') ?? '',
                description: str(m, 'description') ?? '',
                usedBy: strArray(m, 'usedBy') ?? strArray(m, 'used_by') ?? [],
                supportedTypes:
                  strArray(m, 'supportedTypes') ?? strArray(m, 'supported_types') ?? [],
                isStreamModel: bool(m, 'isStreamModel') ?? bool(m, 'is_stream_model') ?? false,
              };
            })
          : [];

        const providers = Array.isArray(providersRaw)
          ? providersRaw.map((p: unknown) => {
              if (!isObject(p))
                throw new Error('Invalid Agent Hub response: provider must be an object');
              return { id: str(p, 'id') ?? '' };
            })
          : [];

        const agents = Array.isArray(agentsRaw) ? agentsRaw.map(decodeAgentInfo) : [];

        return { models, providers, agents };
      },
    },
  };
};
