import type { AuthModule } from '../auth/types.js';
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
// Environment URL resolution
// ---------------------------------------------------------------------------

const readEnvString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const resolveWebNavigatorBaseUrl = (): string => {
  const nodeEnv = readEnvString(
    (globalThis as { process?: { env?: { WEB_NAVIGATOR_BASE_URL?: string } } }).process?.env
      ?.WEB_NAVIGATOR_BASE_URL,
  );
  if (nodeEnv) return nodeEnv;

  const runtime = readEnvString(
    (globalThis as { WEB_NAVIGATOR_BASE_URL?: unknown }).WEB_NAVIGATOR_BASE_URL,
  );
  if (runtime) return runtime;

  return 'http://web-navigator:8080';
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type RawObject = { readonly [key: string]: unknown };

const isObject = (value: unknown): value is RawObject =>
  typeof value === 'object' && value !== null;

// ---------------------------------------------------------------------------
// HTTP transport
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
  const headers: Record<string, string> = { ...options.authHeaders };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  headers['X-Workspace-Id'] = options.workspaceId;

  const response = await fetch(options.url, {
    method: options.method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 202) {
    // Job not yet completed -- parse status from body and surface a typed message
    let jobStatus = 'unknown';
    try {
      const body = (await response.json()) as unknown;
      if (isObject(body)) {
        const s = body['status'];
        if (typeof s === 'string') jobStatus = s;
      }
    } catch {
      // Could not parse 202 body -- use default status label
    }
    throw new Error(`Job not yet completed (status: ${jobStatus})`);
  }

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
        }
      }
    } catch {
      // Could not parse error body -- use default message
    }
    throw new Error(`Web Navigator request failed (${response.status}): ${message}`);
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
 * Creates a Web Navigator REST client bound to a given auth module and workspace.
 *
 * The URL defaults to the `WEB_NAVIGATOR_BASE_URL` environment variable, falling
 * back to `http://web-navigator:8080` for K8s in-cluster use.
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
  const baseUrl = (params.url ?? resolveWebNavigatorBaseUrl()).replace(/\/+$/, '');

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
    } = {},
  ): Promise<T> => {
    const authHeaders = await getAuthHeaders();
    return httpRequest<T>({
      method,
      url: `${baseUrl}${path}`,
      authHeaders,
      workspaceId: params.workspaceId,
      body: opts.body,
    });
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
