import type { AuthModule } from '../auth/types.js';
import { resolveDiskdGatewayUrl } from '../env/baseUrl.js';
import { httpRequest, resolveAuthHeaders, type HttpMethod } from '../sdk/http.js';
import type {
  JobStatusResult,
  ResolveParams,
  ResolveResult,
  ScrapeJob,
  ScrapeParams,
  ScrapeResult,
  ScrapeSubmitResult,
  WebNavigatorClient,
} from './webNavigatorTypes.js';

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
export const createWebNavigatorClient = (params: {
  readonly auth: AuthModule;
  readonly url?: string;
  readonly workspaceId: string;
}): WebNavigatorClient => {
  const baseUrl = (params.url ?? resolveDiskdGatewayUrl('utils/web-navigator')).replace(/\/+$/, '');

  const request = async <T>(
    method: HttpMethod,
    path: string,
    opts: {
      readonly body?: unknown;
    } = {},
  ): Promise<T> => {
    const authHeaders = await resolveAuthHeaders(params.auth);
    return httpRequest<T>({
      method,
      url: `${baseUrl}${path}`,
      authHeaders,
      workspaceId: params.workspaceId,
      body: opts.body,
    }, 'Web Navigator');
  };

  return {
    scrape: {
      submit: async (scrapeParams: ScrapeParams): Promise<ScrapeSubmitResult> =>
        request<ScrapeSubmitResult>('POST', '/api/v1/scrape', { body: scrapeParams }),

      sync: async (scrapeParams: ScrapeParams): Promise<ScrapeSubmitResult> =>
        request<ScrapeSubmitResult>('POST', '/api/v1/scrape/sync', { body: scrapeParams }),

      getJob: async (jobId: string): Promise<ScrapeJob> =>
        request<ScrapeJob>('GET', `/api/v1/scrape/${encodeURIComponent(jobId)}`),

      getStatus: async (jobId: string): Promise<JobStatusResult> =>
        request<JobStatusResult>('GET', `/api/v1/scrape/${encodeURIComponent(jobId)}/status`),

      getResult: async (jobId: string): Promise<ScrapeResult> =>
        request<ScrapeResult>('GET', `/api/v1/scrape/${encodeURIComponent(jobId)}/result`),

      cancel: async (jobId: string): Promise<ScrapeJob> =>
        request<ScrapeJob>('POST', `/api/v1/scrape/${encodeURIComponent(jobId)}/cancel`),
    },

    resolve: async (resolveParams: ResolveParams): Promise<ResolveResult> =>
      request<ResolveResult>('POST', '/api/v1/resolve', { body: resolveParams }),
  };
};
