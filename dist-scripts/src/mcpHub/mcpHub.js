import { resolveDiskdGatewayUrl } from '../env/baseUrl.js';
const isObject = (value) => typeof value === 'object' && value !== null;
const str = (obj, key) => {
    const v = obj[key];
    return typeof v === 'string' ? v : undefined;
};
const bool = (obj, key) => {
    const v = obj[key];
    return typeof v === 'boolean' ? v : undefined;
};
const buildQueryString = (params) => {
    const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
    if (entries.length === 0)
        return '';
    const searchParams = new URLSearchParams();
    for (const [key, value] of entries) {
        searchParams.set(key, String(value));
    }
    return `?${searchParams.toString()}`;
};
// ---------------------------------------------------------------------------
// Response decoders -- minimal, since the REST API returns camelCase
// ---------------------------------------------------------------------------
const decodeServerLog = (o) => {
    if (!isObject(o))
        throw new Error('Invalid MCP Hub response: log entry must be an object');
    return {
        timestamp: str(o, 'timestamp') ?? '',
        level: str(o, 'level') ?? 'info',
        message: str(o, 'message') ?? '',
    };
};
const decodeEnvVarKey = (o) => {
    if (!isObject(o))
        throw new Error('Invalid MCP Hub response: env var entry must be an object');
    const raw = o.value;
    return {
        key: str(o, 'key') ?? '',
        configured: bool(o, 'configured'),
        value: raw === null ? null : typeof raw === 'string' ? raw : undefined,
    };
};
const decodeCatalogServer = (o) => {
    if (!isObject(o))
        throw new Error('Invalid MCP Hub response: catalog server must be an object');
    return o;
};
const decodeServerDetails = (o) => {
    if (!isObject(o))
        throw new Error('Invalid MCP Hub response: server details must be an object');
    return o;
};
const decodeServer = (o) => {
    if (!isObject(o))
        throw new Error('Invalid MCP Hub response: server must be an object');
    return o;
};
const httpRequest = async (options) => {
    const headers = { ...options.authHeaders };
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
            const errorData = (await response.json());
            if (isObject(errorData)) {
                const err = errorData.error;
                if (isObject(err) && typeof err.message === 'string') {
                    message = err.message;
                }
                else if (typeof errorData.message === 'string') {
                    message = errorData.message;
                }
            }
        }
        catch {
            // Could not parse error body -- use default message
        }
        throw new Error(`MCP Hub request failed (${response.status}): ${message}`);
    }
    if (response.status === 204) {
        return undefined;
    }
    return (await response.json());
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
 * The `workspaceId` is forwarded as `X-Workspace-Id` on all registry and
 * integration endpoints. Catalog endpoints are public and do not require it.
 *
 * Example:
 * ```ts
 * const mcp = createMcpHubClient({ auth, workspaceId: 'ws_01...' });
 * const { items } = await mcp.registry.list();
 * ```
 */
export const createMcpHubClient = (params) => {
    const baseUrl = (params.url ?? resolveDiskdGatewayUrl('os/mcp')).replace(/\/+$/, '');
    const getAuthHeaders = async () => {
        if (params.auth.getRequestHeaders) {
            return params.auth.getRequestHeaders();
        }
        const token = await params.auth.getAccessToken();
        return { Authorization: `Bearer ${token}` };
    };
    const request = async (method, path, opts = {}) => {
        const authHeaders = await getAuthHeaders();
        const qs = opts.query ? buildQueryString(opts.query) : '';
        return httpRequest({
            method,
            url: `${baseUrl}${path}${qs}`,
            authHeaders,
            workspaceId: opts.withWorkspace !== false ? params.workspaceId : undefined,
            body: opts.body,
        });
    };
    return {
        registry: {
            list: async () => request('GET', '/api/registry', { withWorkspace: true }),
            addServer: async (addParams) => request('POST', '/api/registry/servers', {
                withWorkspace: true,
                body: addParams,
            }),
            addRemoteServer: async (addParams) => request('POST', '/api/registry/servers/remote', {
                withWorkspace: true,
                body: addParams,
            }),
            updateServer: async (serverId, updateParams) => request('PATCH', `/api/registry/servers/${encodeURIComponent(serverId)}`, { withWorkspace: true, body: updateParams }),
            updateServerAlias: async (serverId, aliasParams) => {
                const raw = await request('PATCH', `/api/registry/servers/${encodeURIComponent(serverId)}/alias`, { withWorkspace: true, body: aliasParams });
                return decodeServer(raw);
            },
            deleteServer: async (serverId) => request('DELETE', `/api/registry/servers/${encodeURIComponent(serverId)}`, { withWorkspace: true }),
            restartServer: async (serverId) => request('POST', `/api/registry/servers/${encodeURIComponent(serverId)}/restart`, { withWorkspace: true }),
            getServerLogs: async (serverId, logParams) => {
                const raw = await request('GET', `/api/registry/servers/${encodeURIComponent(serverId)}/logs`, {
                    withWorkspace: true,
                    query: { since: logParams?.since, limit: logParams?.limit },
                });
                return {
                    serverId: raw.serverId,
                    logs: raw.logs.map(decodeServerLog),
                };
            },
            toggleTool: async (serverId, toolId, enabled) => request('PATCH', `/api/registry/servers/${encodeURIComponent(serverId)}/tools/${encodeURIComponent(toolId)}`, { withWorkspace: true, body: { enabled } }),
            listEnvVars: async (serverId) => {
                const raw = await request('GET', `/api/registry/servers/${encodeURIComponent(serverId)}/env`, { withWorkspace: true });
                return { items: raw.items.map(decodeEnvVarKey) };
            },
            upsertEnvVar: async (serverId, envParams) => {
                await request('PUT', `/api/registry/servers/${encodeURIComponent(serverId)}/env`, {
                    withWorkspace: true,
                    body: envParams,
                });
            },
            deleteEnvVar: async (serverId, key) => {
                await request('DELETE', `/api/registry/servers/${encodeURIComponent(serverId)}/env/${encodeURIComponent(key)}`, { withWorkspace: true });
            },
            listConnectionSettings: async (serverId) => request('GET', `/api/registry/servers/${encodeURIComponent(serverId)}/settings`, { withWorkspace: true }),
            revealConnectionSetting: async (serverId, settingId) => request('POST', `/api/registry/servers/${encodeURIComponent(serverId)}/settings/${encodeURIComponent(settingId)}/reveal`, { withWorkspace: true }),
            updateConnectionSetting: async (serverId, settingId, settingParams) => {
                await request('PUT', `/api/registry/servers/${encodeURIComponent(serverId)}/settings/${encodeURIComponent(settingId)}`, { withWorkspace: true, body: settingParams });
            },
            deleteConnectionSetting: async (serverId, settingId) => {
                await request('DELETE', `/api/registry/servers/${encodeURIComponent(serverId)}/settings/${encodeURIComponent(settingId)}`, { withWorkspace: true });
            },
        },
        catalog: {
            list: async (catalogParams) => {
                const raw = await request('GET', '/api/catalog', {
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
            getServerDetails: async (serverId) => {
                const raw = await request('GET', `/api/catalog/${encodeURIComponent(serverId)}`, {
                    withWorkspace: false,
                });
                return decodeServerDetails(raw);
            },
        },
        integrations: {
            requestIntegration: async (integrationParams) => request('POST', '/api/integration-requests', {
                withWorkspace: true,
                body: integrationParams,
            }),
        },
    };
};
