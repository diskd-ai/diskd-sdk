import { resolveDiskdGatewayUrl } from '../env/baseUrl.js';
import { httpRequest, resolveAuthHeaders } from '../sdk/http.js';
// ---------------------------------------------------------------------------
// Decode / encode
// ---------------------------------------------------------------------------
const decodeOperative = (wire) => {
    const { intelAccess, brainProvider, brainModel, brainMode, ...rest } = wire;
    return {
        ...rest,
        fileAccess: intelAccess,
        engineProvider: brainProvider,
        engineModel: brainModel,
        engine: brainMode,
    };
};
const decodeFile = (wire) => ({
    id: wire.id,
    operativeId: wire.operativeId,
    path: wire.sourceId,
    createdAt: wire.createdAt,
});
const decodeSkill = (wire) => ({
    id: wire.id,
    operativeId: wire.operativeId,
    refId: wire.refId ?? '',
    createdAt: wire.createdAt,
});
const decodeTool = (wire) => ({
    id: wire.id,
    operativeId: wire.operativeId,
    selector: wire.selector ?? '',
    display: wire.display,
    resolutionStatus: wire.resolutionStatus,
    createdAt: wire.createdAt,
});
/** Encode SDK field names to app-service wire format. */
const encodeParams = (params) => {
    const wire = { ...params };
    if ('fileAccess' in wire) {
        wire.intelAccess = wire.fileAccess;
        delete wire.fileAccess;
    }
    if ('engineProvider' in wire) {
        wire.brainProvider = wire.engineProvider;
        delete wire.engineProvider;
    }
    if ('engineModel' in wire) {
        wire.brainModel = wire.engineModel;
        delete wire.engineModel;
    }
    if ('engine' in wire) {
        wire.brainMode = wire.engine;
        delete wire.engine;
    }
    return wire;
};
// ---------------------------------------------------------------------------
// Query params
// ---------------------------------------------------------------------------
const buildQuery = (entries) => {
    const parts = [];
    for (const [key, value] of entries) {
        if (value !== undefined) {
            parts.push(`${key}=${encodeURIComponent(value)}`);
        }
    }
    return parts.length > 0 ? `?${parts.join('&')}` : '';
};
// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------
/**
 * Creates an Operatives REST client bound to a given auth module.
 *
 * The URL defaults to the centralized `DISKD_BASE_URL` gateway with the
 * `/platform/app` path prefix.
 *
 * Example:
 * ```ts
 * const ops = createOperativesClient({ auth });
 * const list = await ops.list({ projectId: 'proj-1' });
 * await ops.files.add('op-01', { paths: ['/docs/notes'] });
 * await ops.skills.add('op-01', { refIds: ['web-search'] });
 * await ops.tools.add('op-01', { selectors: ['github/search_repos'] });
 * ```
 */
export const createOperativesClient = (params) => {
    const baseUrl = (params.url ?? resolveDiskdGatewayUrl('platform/operatives')).replace(/\/+$/, '');
    const request = async (method, path, opts = {}) => {
        const authHeaders = await resolveAuthHeaders(params.auth);
        return httpRequest({
            method,
            url: `${baseUrl}${path}`,
            authHeaders,
            body: opts.body,
        }, 'Operatives');
    };
    const encId = (id) => encodeURIComponent(id);
    return {
        list: async (listParams) => {
            const query = buildQuery([['projectId', listParams.projectId]]);
            const items = await request('GET', `/api/operatives${query}`);
            return items.map(decodeOperative);
        },
        get: async (operativeId) => {
            const wire = await request('GET', `/api/operatives/${encId(operativeId)}`);
            return decodeOperative(wire);
        },
        getBySlug: async (slugParams) => {
            const query = buildQuery([
                ['projectId', slugParams.projectId],
                ['slug', slugParams.slug],
            ]);
            const wire = await request('GET', `/api/operatives/by-slug${query}`);
            return decodeOperative(wire);
        },
        create: async (createParams) => {
            const wire = await request('POST', '/api/operatives', {
                body: encodeParams({ ...createParams }),
            });
            return decodeOperative(wire);
        },
        update: async (operativeId, updateParams) => {
            const wire = await request('PATCH', `/api/operatives/${encId(operativeId)}`, {
                body: encodeParams({ ...updateParams }),
            });
            return decodeOperative(wire);
        },
        delete: async (operativeId) => {
            await request('DELETE', `/api/operatives/${encId(operativeId)}`);
        },
        files: {
            list: async (operativeId) => {
                const items = await request('GET', `/api/operatives/${encId(operativeId)}/intel`);
                return items.map(decodeFile);
            },
            add: async (operativeId, addParams) => {
                const results = [];
                for (const path of addParams.paths) {
                    const wire = await request('POST', `/api/operatives/${encId(operativeId)}/intel`, {
                        body: { sourceId: path },
                    });
                    results.push(decodeFile(wire));
                }
                return results;
            },
            remove: async (operativeId, linkId) => {
                await request('DELETE', `/api/operatives/${encId(operativeId)}/intel/${encId(linkId)}`);
            },
        },
        skills: {
            list: async (operativeId) => {
                const result = await request('GET', `/api/operatives/${encId(operativeId)}/equipment`);
                return result.items.filter((e) => e.equipmentType === 'skill').map(decodeSkill);
            },
            add: async (operativeId, addParams) => {
                const results = [];
                for (const refId of addParams.refIds) {
                    const wire = await request('POST', `/api/operatives/${encId(operativeId)}/equipment`, {
                        body: { equipmentType: 'skill', refId },
                    });
                    results.push(decodeSkill(wire));
                }
                return results;
            },
            remove: async (operativeId, linkId) => {
                await request('DELETE', `/api/operatives/${encId(operativeId)}/equipment/${encId(linkId)}`);
            },
        },
        tools: {
            list: async (operativeId) => {
                const result = await request('GET', `/api/operatives/${encId(operativeId)}/equipment`);
                return result.items.filter((e) => e.equipmentType === 'mcp_tool').map(decodeTool);
            },
            add: async (operativeId, addParams) => {
                const results = [];
                for (const selector of addParams.selectors) {
                    const wire = await request('POST', `/api/operatives/${encId(operativeId)}/equipment`, {
                        body: { equipmentType: 'mcp_tool', selector },
                    });
                    results.push(decodeTool(wire));
                }
                return results;
            },
            remove: async (operativeId, linkId) => {
                await request('DELETE', `/api/operatives/${encId(operativeId)}/equipment/${encId(linkId)}`);
            },
        },
    };
};
