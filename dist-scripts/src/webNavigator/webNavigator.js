import { resolveDiskdGatewayUrl } from '../env/baseUrl.js';
import { httpRequest, resolveAuthHeaders } from '../sdk/http.js';
// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------
/**
 * Creates a Web Navigator REST client bound to a given auth module and workspace.
 *
 * The URL defaults to the centralized `DISKD_BASE_URL` gateway with the
 * `/utils/web-navigator` path prefix.
 *
 * The `workspaceId` is forwarded as `X-Workspace-Id` on all requests.
 *
 * Example:
 * ```ts
 * const nav = createWebNavigatorClient({ auth, workspaceId: 'ws_01...' });
 * const job = await nav.scrape.submit({ url: 'https://example.com', depth: 1 });
 * ```
 */
export const createWebNavigatorClient = (params) => {
    const baseUrl = (params.url ?? resolveDiskdGatewayUrl('utils/web-navigator')).replace(/\/+$/, '');
    const request = async (method, path, opts = {}) => {
        const authHeaders = await resolveAuthHeaders(params.auth);
        return httpRequest({
            method,
            url: `${baseUrl}${path}`,
            authHeaders,
            workspaceId: params.workspaceId,
            body: opts.body,
        }, 'Web Navigator');
    };
    return {
        scrape: {
            submit: async (scrapeParams) => request('POST', '/api/v1/scrape', { body: scrapeParams }),
            sync: async (scrapeParams) => request('POST', '/api/v1/scrape/sync', { body: scrapeParams }),
            getJob: async (jobId) => request('GET', `/api/v1/scrape/${encodeURIComponent(jobId)}`),
            getStatus: async (jobId) => request('GET', `/api/v1/scrape/${encodeURIComponent(jobId)}/status`),
            getResult: async (jobId) => request('GET', `/api/v1/scrape/${encodeURIComponent(jobId)}/result`),
            cancel: async (jobId) => request('POST', `/api/v1/scrape/${encodeURIComponent(jobId)}/cancel`),
        },
        resolve: async (resolveParams) => request('POST', '/api/v1/resolve', { body: resolveParams }),
    };
};
