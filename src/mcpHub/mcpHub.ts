import type { AuthModule } from '../auth/types.js';
import { resolveDiskdGatewayUrl } from '../env/baseUrl.js';
import type {
  AddRemoteServerParams,
  AddServerParams,
  AddServerResult,
  CatalogListResult,
  CatalogQueryParams,
  DeleteServerResult,
  EnvVarKey,
  GetServerLogsParams,
  GetServerLogsResult,
  ListConnectionSettingsResult,
  ListEnvVarsResult,
  McpCatalogServer,
  McpHubClient,
  McpRegistryResult,
  McpServer,
  McpServerDetails,
  McpServerLog,
  RequestIntegrationParams,
  RequestIntegrationResult,
  RestartServerResult,
  RevealConnectionSettingResult,
  ToggleToolResult,
  UpdateConnectionSettingParams,
  UpdateServerAliasParams,
  UpdateServerParams,
  UpdateServerResult,
  UpsertEnvVarParams,
} from './mcpHubTypes.js';

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
// Response decoders -- minimal, since the REST API returns camelCase
// ---------------------------------------------------------------------------

const decodeServerLog = (o: unknown): McpServerLog => {
  if (!isObject(o)) throw new Error('Invalid MCP Hub response: log entry must be an object');
  return {
    timestamp: str(o, 'timestamp') ?? '',
    level: (str(o, 'level') as McpServerLog['level']) ?? 'info',
    message: str(o, 'message') ?? '',
  };
};

const decodeEnvVarKey = (o: unknown): EnvVarKey => {
  if (!isObject(o)) throw new Error('Invalid MCP Hub response: env var entry must be an object');
  const raw = o.value;
  return {
    key: str(o, 'key') ?? '',
    configured: bool(o, 'configured'),
    value: raw === null ? null : typeof raw === 'string' ? raw : undefined,
  };
};

const decodeCatalogServer = (o: unknown): McpCatalogServer => {
  if (!isObject(o)) throw new Error('Invalid MCP Hub response: catalog server must be an object');
  return o as unknown as McpCatalogServer;
};

const decodeServerDetails = (o: unknown): McpServerDetails => {
  if (!isObject(o)) throw new Error('Invalid MCP Hub response: server details must be an object');
  return o as unknown as McpServerDetails;
};

const decodeServer = (o: unknown): McpServer => {
  if (!isObject(o)) throw new Error('Invalid MCP Hub response: server must be an object');
  return o as unknown as McpServer;
};

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
    throw new Error(`MCP Hub request failed (${response.status}): ${message}`);
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
 * Creates an MCP Hub REST client bound to a given auth module and workspace.
 *
 * The URL defaults to the centralized `DISKD_BASE_URL` gateway with the
 * `/os/mcp` path prefix.
 *
 * The workspace is derived from `auth.getWorkspaceId()` and forwarded as
 * `X-Workspace-Id` on all registry and integration endpoints. Catalog
 * endpoints are public and do not require it.
 *
 * Example:
 * ```ts
 * const mcp = createMcpHubClient({ auth });
 * const { items } = await mcp.registry.list();
 * ```
 */
export const createMcpHubClient = (params: {
  readonly auth: AuthModule;
  readonly url?: string;
}): McpHubClient => {
  const baseUrl = (params.url ?? resolveDiskdGatewayUrl('os/mcp')).replace(/\/+$/, '');

  const resolveWorkspaceId = async (): Promise<string | undefined> =>
    await params.auth.getWorkspaceId();

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
    } = {}
  ): Promise<T> => {
    const authHeaders = await getAuthHeaders();
    const qs = opts.query ? buildQueryString(opts.query) : '';
    return httpRequest<T>({
      method,
      url: `${baseUrl}${path}${qs}`,
      authHeaders,
      workspaceId: opts.withWorkspace !== false ? await resolveWorkspaceId() : undefined,
      body: opts.body,
    });
  };

  return {
    registry: {
      list: async (): Promise<McpRegistryResult> =>
        request<McpRegistryResult>('GET', '/api/registry', { withWorkspace: true }),

      addServer: async (addParams: AddServerParams): Promise<AddServerResult> =>
        request<AddServerResult>('POST', '/api/registry/servers', {
          withWorkspace: true,
          body: addParams,
        }),

      addRemoteServer: async (
        addParams: AddRemoteServerParams
      ): Promise<{ readonly server: McpServer }> =>
        request<{ readonly server: McpServer }>('POST', '/api/registry/servers/remote', {
          withWorkspace: true,
          body: addParams,
        }),

      updateServer: async (
        serverId: string,
        updateParams: UpdateServerParams
      ): Promise<UpdateServerResult> =>
        request<UpdateServerResult>(
          'PATCH',
          `/api/registry/servers/${encodeURIComponent(serverId)}`,
          { withWorkspace: true, body: updateParams }
        ),

      updateServerAlias: async (
        serverId: string,
        aliasParams: UpdateServerAliasParams
      ): Promise<McpServer> => {
        const raw = await request<unknown>(
          'PATCH',
          `/api/registry/servers/${encodeURIComponent(serverId)}/alias`,
          { withWorkspace: true, body: aliasParams }
        );
        return decodeServer(raw);
      },

      deleteServer: async (serverId: string): Promise<DeleteServerResult> =>
        request<DeleteServerResult>(
          'DELETE',
          `/api/registry/servers/${encodeURIComponent(serverId)}`,
          { withWorkspace: true }
        ),

      restartServer: async (serverId: string): Promise<RestartServerResult> =>
        request<RestartServerResult>(
          'POST',
          `/api/registry/servers/${encodeURIComponent(serverId)}/restart`,
          { withWorkspace: true }
        ),

      getServerLogs: async (
        serverId: string,
        logParams?: GetServerLogsParams
      ): Promise<GetServerLogsResult> => {
        const raw = await request<{ readonly serverId: string; readonly logs: readonly unknown[] }>(
          'GET',
          `/api/registry/servers/${encodeURIComponent(serverId)}/logs`,
          {
            withWorkspace: true,
            query: { since: logParams?.since, limit: logParams?.limit },
          }
        );
        return {
          serverId: raw.serverId,
          logs: raw.logs.map(decodeServerLog),
        };
      },

      toggleTool: async (
        serverId: string,
        toolId: string,
        enabled: boolean
      ): Promise<ToggleToolResult> =>
        request<ToggleToolResult>(
          'PATCH',
          `/api/registry/servers/${encodeURIComponent(serverId)}/tools/${encodeURIComponent(toolId)}`,
          { withWorkspace: true, body: { enabled } }
        ),

      listEnvVars: async (serverId: string): Promise<ListEnvVarsResult> => {
        const raw = await request<{ readonly items: readonly unknown[] }>(
          'GET',
          `/api/registry/servers/${encodeURIComponent(serverId)}/env`,
          { withWorkspace: true }
        );
        return { items: raw.items.map(decodeEnvVarKey) };
      },

      upsertEnvVar: async (serverId: string, envParams: UpsertEnvVarParams): Promise<void> => {
        await request<void>('PUT', `/api/registry/servers/${encodeURIComponent(serverId)}/env`, {
          withWorkspace: true,
          body: envParams,
        });
      },

      deleteEnvVar: async (serverId: string, key: string): Promise<void> => {
        await request<void>(
          'DELETE',
          `/api/registry/servers/${encodeURIComponent(serverId)}/env/${encodeURIComponent(key)}`,
          { withWorkspace: true }
        );
      },

      listConnectionSettings: async (serverId: string): Promise<ListConnectionSettingsResult> =>
        request<ListConnectionSettingsResult>(
          'GET',
          `/api/registry/servers/${encodeURIComponent(serverId)}/settings`,
          { withWorkspace: true }
        ),

      revealConnectionSetting: async (
        serverId: string,
        settingId: string
      ): Promise<RevealConnectionSettingResult> =>
        request<RevealConnectionSettingResult>(
          'POST',
          `/api/registry/servers/${encodeURIComponent(serverId)}/settings/${encodeURIComponent(settingId)}/reveal`,
          { withWorkspace: true }
        ),

      updateConnectionSetting: async (
        serverId: string,
        settingId: string,
        settingParams: UpdateConnectionSettingParams
      ): Promise<void> => {
        await request<void>(
          'PUT',
          `/api/registry/servers/${encodeURIComponent(serverId)}/settings/${encodeURIComponent(settingId)}`,
          { withWorkspace: true, body: settingParams }
        );
      },

      deleteConnectionSetting: async (serverId: string, settingId: string): Promise<void> => {
        await request<void>(
          'DELETE',
          `/api/registry/servers/${encodeURIComponent(serverId)}/settings/${encodeURIComponent(settingId)}`,
          { withWorkspace: true }
        );
      },
    },

    catalog: {
      list: async (catalogParams?: CatalogQueryParams): Promise<CatalogListResult> => {
        const raw = await request<{
          readonly items: readonly unknown[];
          readonly total: number;
          readonly page: number;
          readonly pageSize: number;
          readonly totalPages: number;
        }>('GET', '/api/catalog', {
          withWorkspace: false,
          query: catalogParams
            ? {
                search: catalogParams.search,
                category: catalogParams.category,
                type: catalogParams.type,
                page: catalogParams.page,
                pageSize: catalogParams.pageSize,
              }
            : undefined,
        });
        return {
          items: raw.items.map(decodeCatalogServer),
          total: raw.total,
          page: raw.page,
          pageSize: raw.pageSize,
          totalPages: raw.totalPages,
        };
      },

      getServerDetails: async (serverId: string): Promise<McpServerDetails> => {
        const raw = await request<unknown>('GET', `/api/catalog/${encodeURIComponent(serverId)}`, {
          withWorkspace: false,
        });
        return decodeServerDetails(raw);
      },
    },

    integrations: {
      requestIntegration: async (
        integrationParams: RequestIntegrationParams
      ): Promise<RequestIntegrationResult> =>
        request<RequestIntegrationResult>('POST', '/api/integration-requests', {
          withWorkspace: true,
          body: integrationParams,
        }),
    },
  };
};
