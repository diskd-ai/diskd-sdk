import { resolveDiskdGatewayUrl } from '../env/baseUrl.js';
import { StreamProtocolFetcher } from './StreamProtocolFetcher.js';
const isObject = (value) => typeof value === 'object' && value !== null;
const str = (obj, key) => {
    const v = obj[key];
    return typeof v === 'string' ? v : undefined;
};
const bool = (obj, key) => {
    const v = obj[key];
    return typeof v === 'boolean' ? v : undefined;
};
const strArray = (obj, key) => {
    const v = obj[key];
    if (!Array.isArray(v))
        return undefined;
    return v.filter((item) => typeof item === 'string');
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
// Response decoders
// ---------------------------------------------------------------------------
const decodeAgentInfo = (o) => {
    if (!isObject(o))
        throw new Error('Invalid Agent Hub response: agent info must be an object');
    return {
        id: str(o, 'id') ?? '',
        displayName: str(o, 'displayName') ?? str(o, 'display_name') ?? '',
    };
};
const httpRequest = async (options) => {
    const headers = {
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
        throw new Error(`Agent Hub request failed (${response.status}): ${message}`);
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
export const createAgentHubClient = (params) => {
    const baseUrl = (params.url ?? resolveDiskdGatewayUrl('os/agents')).replace(/\/+$/, '');
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
            workspaceId: params.workspaceId,
            body: opts.body,
        });
    };
    return {
        invoke: async (invokeParams) => {
            const authHeaders = await getAuthHeaders();
            return StreamProtocolFetcher.fetchStream(`${baseUrl}/invoke`, {
                method: 'POST',
                headers: {
                    ...authHeaders,
                    'X-Workspace-Id': params.workspaceId,
                },
                body: invokeParams,
            });
        },
        agents: {
            list: async () => {
                const raw = await request('GET', '/supported-agents');
                return Array.isArray(raw) ? raw.map(decodeAgentInfo) : [];
            },
            getSupportedModels: async (agentId) => {
                const raw = await request('GET', '/supported-models', {
                    query: { agent: agentId },
                });
                const modelsRaw = raw.models;
                if (!Array.isArray(modelsRaw))
                    return { models: [] };
                return {
                    models: modelsRaw.map((m) => {
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
            getAliases: async () => {
                const raw = await request('GET', '/billing-aliases');
                const modelsRaw = raw.models;
                const providersRaw = raw.providers;
                const agentsRaw = raw.agents;
                const models = Array.isArray(modelsRaw)
                    ? modelsRaw.map((m) => {
                        if (!isObject(m))
                            throw new Error('Invalid Agent Hub response: billing alias model must be an object');
                        return {
                            billingAlias: str(m, 'billingAlias') ?? str(m, 'billing_alias') ?? '',
                            provider: str(m, 'provider') ?? '',
                            model: str(m, 'model') ?? '',
                            displayName: str(m, 'displayName') ?? str(m, 'display_name') ?? '',
                            description: str(m, 'description') ?? '',
                            usedBy: strArray(m, 'usedBy') ?? strArray(m, 'used_by') ?? [],
                            supportedTypes: strArray(m, 'supportedTypes') ?? strArray(m, 'supported_types') ?? [],
                            isStreamModel: bool(m, 'isStreamModel') ?? bool(m, 'is_stream_model') ?? false,
                        };
                    })
                    : [];
                const providers = Array.isArray(providersRaw)
                    ? providersRaw.map((p) => {
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
