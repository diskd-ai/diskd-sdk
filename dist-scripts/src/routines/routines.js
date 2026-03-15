import { resolveDiskdGatewayUrl } from '../env/baseUrl.js';
import { buildQuery, httpRequest, resolveAuthHeaders } from '../sdk/http.js';
// ---------------------------------------------------------------------------
// Scope query params
// ---------------------------------------------------------------------------
const buildScopeQuery = (scope, projectName) => buildQuery([
    ['scope', scope],
    ['projectName', projectName],
]);
const scopeRefToQuery = (scope) => {
    if (!scope)
        return '';
    if (scope.scopeType === 'project') {
        return buildScopeQuery(scope.scopeType, scope.projectName);
    }
    return buildScopeQuery(scope.scopeType);
};
// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------
/**
 * Creates a Routines REST client bound to a given auth module.
 *
 * The URL defaults to the centralized `DISKD_BASE_URL` gateway with the
 * `/platform/app` path prefix.
 *
 * Example:
 * ```ts
 * const routines = createRoutinesClient({ auth });
 * const all = await routines.list({ scope: 'profile' });
 * ```
 */
export const createRoutinesClient = (params) => {
    const baseUrl = (params.url ?? resolveDiskdGatewayUrl('platform/routines')).replace(/\/+$/, '');
    const request = async (method, path, opts = {}) => {
        const authHeaders = await resolveAuthHeaders(params.auth);
        return httpRequest({
            method,
            url: `${baseUrl}${path}`,
            authHeaders,
            body: opts.body,
        }, 'Routines');
    };
    return {
        list: async (listParams) => {
            const query = buildScopeQuery(listParams?.scope, listParams?.projectName);
            const result = await request('GET', `/api/routines${query}`);
            return result.items;
        },
        get: async (getParams) => {
            const query = buildScopeQuery(getParams.scope, getParams.projectName);
            const slug = encodeURIComponent(getParams.slug);
            const result = await request('GET', `/api/routines/${slug}${query}`);
            return result.routine;
        },
        create: async (createParams) => {
            const result = await request('POST', '/api/routines', {
                body: createParams,
            });
            return result.routine;
        },
        update: async (slug, updateParams, scope) => {
            const query = scopeRefToQuery(scope);
            const encodedSlug = encodeURIComponent(slug);
            const result = await request('PATCH', `/api/routines/${encodedSlug}${query}`, {
                body: updateParams,
            });
            return result.routine;
        },
        delete: async (deleteParams) => {
            const query = buildScopeQuery(deleteParams.scope, deleteParams.projectName);
            const slug = encodeURIComponent(deleteParams.slug);
            await request('DELETE', `/api/routines/${slug}${query}`);
        },
    };
};
