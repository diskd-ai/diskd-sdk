// Domain types for the MCP Hub API.
// These are pure data types only -- no classes, no I/O, no side effects.
// The MCP Hub REST API already returns camelCase; no wire-level conversion needed.

// -- Registry types (installed MCP servers for a workspace) --

export type McpServerStatus = 'active' | 'inactive';

export type McpRuntimeState = 'starting' | 'running' | 'failed' | 'stopped';

export type McpRuntimeSummary = {
  readonly lastSessionId?: string;
  readonly state?: McpRuntimeState;
  readonly errorMessage?: string;
  readonly startedAt?: string;
  readonly stoppedAt?: string;
  readonly observedAt: string;
};

export type McpTool = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
};

export type McpServer = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly status: McpServerStatus;
  readonly icon: string;
  readonly tools: readonly McpTool[];
  readonly catalogServerId?: string;
  readonly instanceNamespace?: string;
  readonly alias?: string;
  readonly runtime?: McpRuntimeSummary;
};

// -- Catalog types (available MCP servers to install) --

export type McpCatalogCategory =
  | 'Development'
  | 'Web Scraping'
  | 'Cloud Service'
  | 'Productivity'
  | 'Search'
  | 'Cloud Storage'
  | 'Communication'
  | 'Other';

export type McpCatalogServer = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly connectionTypes: readonly string[];
  readonly category: McpCatalogCategory;
  readonly requiredEnvVars: readonly string[];
};

export type McpServerDetails = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly readme: string;
  readonly version: string;
  readonly author: string;
  readonly license: string;
  readonly repositoryUrl: string;
  readonly documentationUrl?: string;
  readonly tags: readonly string[];
  readonly connectionTypes: readonly string[];
  readonly category: McpCatalogCategory;
  readonly tools: readonly McpTool[];
  readonly requiredEnvVars: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
};

// -- Server logs --

export type McpServerLog = {
  readonly timestamp: string;
  readonly level: 'info' | 'warn' | 'error' | 'debug';
  readonly message: string;
};

// -- Environment variable types --

export type EnvVarKey = {
  readonly key: string;
  readonly configured?: boolean;
  readonly value?: string | null;
};

// -- Connection settings types --

export type ConnectionSettingRequirement = 'required' | 'optional';

export type ConnectionSettingValueState =
  | { readonly tag: 'missing' }
  | { readonly tag: 'stored'; readonly maskedValue: string };

export type ConnectionSettingSummary = {
  readonly kind: 'secret-text';
  readonly settingId: string;
  readonly label: string;
  readonly description: string;
  readonly requirement: ConnectionSettingRequirement;
  readonly valueState: ConnectionSettingValueState;
};

// -- Runtime operation types --

export type RuntimeSessionState = 'starting' | 'running' | 'failed' | 'stopped';

export type RuntimeSessionSummary = {
  readonly id: string;
  readonly runtimeInstanceId: string;
  readonly workspaceInstanceId: string;
  readonly state: RuntimeSessionState;
  readonly createdAt?: string;
  readonly updatedAt?: string;
};

export type RuntimeOperationResponse = {
  readonly operationId: string;
  readonly session: RuntimeSessionSummary;
};

// -- Registry method params and results --

export type McpRegistryResult = {
  readonly items: readonly McpServer[];
};

export type AddServerParams = {
  readonly catalogServerId: string;
  readonly alias?: string;
};

export type AddRemoteServerParams = {
  readonly name: string;
  readonly url: string;
  readonly authType: 'none' | 'pat' | 'oauth';
  readonly authToken?: string;
};

export type AddServerResult = { readonly server: McpServer } | RuntimeOperationResponse;

export type UpdateServerParams = {
  readonly status?: McpServerStatus;
};

export type UpdateServerAliasParams = {
  readonly alias: string;
};

export type UpdateServerResult = McpServer | RuntimeOperationResponse;

export type DeleteServerResult = undefined | RuntimeOperationResponse;

export type RestartServerResult = McpServer | RuntimeOperationResponse;

export type GetServerLogsParams = {
  readonly since?: string;
  readonly limit?: number;
};

export type GetServerLogsResult = {
  readonly serverId: string;
  readonly logs: readonly McpServerLog[];
};

export type ToggleToolResult = {
  readonly tool: McpTool;
};

export type ListEnvVarsResult = {
  readonly items: readonly EnvVarKey[];
};

export type UpsertEnvVarParams = {
  readonly key: string;
  readonly value: string;
};

export type ListConnectionSettingsResult = {
  readonly settings: readonly ConnectionSettingSummary[];
};

export type RevealConnectionSettingResult = {
  readonly kind: 'secret-text';
  readonly settingId: string;
  readonly value: string;
};

export type UpdateConnectionSettingParams = {
  readonly kind: 'secret-text';
  readonly value: string;
};

// -- Catalog method params and results --

export type CatalogQueryParams = {
  readonly search?: string;
  readonly category?: McpCatalogCategory | 'all';
  readonly type?: string;
  readonly page?: number;
  readonly pageSize?: number;
};

export type CatalogListResult = {
  readonly items: readonly McpCatalogServer[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
};

// -- Integration request params and results --

export type RequestIntegrationParams = {
  readonly githubUrl: string;
  readonly motivation: string;
};

export type RequestIntegrationResult = {
  readonly requestId: string;
  readonly status: 'submitted';
};

// -- Client interface --

/**
 * MCP Hub REST client organized by namespace.
 *
 * Obtain via `createMcpHubClient`. The `workspaceId` is bound at creation time
 * and is forwarded as `X-Workspace-Id` on all registry and integration calls.
 */
export type McpHubClient = {
  readonly registry: {
    /** GET /api/registry -- list installed servers for the workspace. */
    readonly list: () => Promise<McpRegistryResult>;
    /** POST /api/registry/servers -- install a catalog server. */
    readonly addServer: (params: AddServerParams) => Promise<AddServerResult>;
    /** POST /api/registry/servers/remote -- add a remote (self-hosted) server. */
    readonly addRemoteServer: (
      params: AddRemoteServerParams
    ) => Promise<{ readonly server: McpServer }>;
    /** PATCH /api/registry/servers/{id} -- update server status. */
    readonly updateServer: (
      serverId: string,
      params: UpdateServerParams
    ) => Promise<UpdateServerResult>;
    /** PATCH /api/registry/servers/{id}/alias -- rename server alias. */
    readonly updateServerAlias: (
      serverId: string,
      params: UpdateServerAliasParams
    ) => Promise<McpServer>;
    /** DELETE /api/registry/servers/{id} -- remove an installed server. */
    readonly deleteServer: (serverId: string) => Promise<DeleteServerResult>;
    /** POST /api/registry/servers/{id}/restart -- restart a server runtime. */
    readonly restartServer: (serverId: string) => Promise<RestartServerResult>;
    /** GET /api/registry/servers/{id}/logs -- fetch server runtime logs. */
    readonly getServerLogs: (
      serverId: string,
      params?: GetServerLogsParams
    ) => Promise<GetServerLogsResult>;
    /** PATCH /api/registry/servers/{id}/tools/{toolId} -- enable or disable a tool. */
    readonly toggleTool: (
      serverId: string,
      toolId: string,
      enabled: boolean
    ) => Promise<ToggleToolResult>;
    /** GET /api/registry/servers/{id}/env -- list environment variable keys. */
    readonly listEnvVars: (serverId: string) => Promise<ListEnvVarsResult>;
    /** PUT /api/registry/servers/{id}/env -- upsert an environment variable. */
    readonly upsertEnvVar: (serverId: string, params: UpsertEnvVarParams) => Promise<void>;
    /** DELETE /api/registry/servers/{id}/env/{key} -- delete an environment variable. */
    readonly deleteEnvVar: (serverId: string, key: string) => Promise<void>;
    /** GET /api/registry/servers/{id}/settings -- list connection settings. */
    readonly listConnectionSettings: (serverId: string) => Promise<ListConnectionSettingsResult>;
    /** POST /api/registry/servers/{id}/settings/{settingId}/reveal -- reveal a secret setting value. */
    readonly revealConnectionSetting: (
      serverId: string,
      settingId: string
    ) => Promise<RevealConnectionSettingResult>;
    /** PUT /api/registry/servers/{id}/settings/{settingId} -- update a connection setting. */
    readonly updateConnectionSetting: (
      serverId: string,
      settingId: string,
      params: UpdateConnectionSettingParams
    ) => Promise<void>;
    /** DELETE /api/registry/servers/{id}/settings/{settingId} -- delete a connection setting. */
    readonly deleteConnectionSetting: (serverId: string, settingId: string) => Promise<void>;
  };

  readonly catalog: {
    /** GET /api/catalog -- list available catalog servers (public, no workspace required). */
    readonly list: (params?: CatalogQueryParams) => Promise<CatalogListResult>;
    /** GET /api/catalog/{id} -- get catalog server details (public). */
    readonly getServerDetails: (serverId: string) => Promise<McpServerDetails>;
  };

  readonly integrations: {
    /** POST /api/integration-requests -- submit a new MCP server integration request. */
    readonly requestIntegration: (
      params: RequestIntegrationParams
    ) => Promise<RequestIntegrationResult>;
  };
};
