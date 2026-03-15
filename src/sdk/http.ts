// Shared HTTP transport for REST clients (routines, operatives, webNavigator).

import type { AuthModule } from '../auth/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type RawObject = { readonly [key: string]: unknown };

const isObject = (value: unknown): value is RawObject =>
  typeof value === 'object' && value !== null;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export type HttpRequestOptions = {
  readonly method: HttpMethod;
  readonly url: string;
  readonly authHeaders: Readonly<Record<string, string>>;
  readonly workspaceId?: string;
  readonly body?: unknown;
};

// ---------------------------------------------------------------------------
// httpRequest
// ---------------------------------------------------------------------------

export const httpRequest = async <T>(
  options: HttpRequestOptions,
  errorLabel: string
): Promise<T> => {
  const headers: Record<string, string> = { ...options.authHeaders };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (options.workspaceId) {
    headers['X-Workspace-Id'] = options.workspaceId;
  }

  const response = await fetch(options.url, {
    method: options.method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 202) {
    let jobStatus = 'unknown';
    try {
      const body = (await response.json()) as unknown;
      if (isObject(body)) {
        const s = body.status;
        if (typeof s === 'string') jobStatus = s;
      }
    } catch {
      // Could not parse 202 body
    }
    throw new Error(`Job not yet completed (status: ${jobStatus})`);
  }

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
      // Could not parse error body
    }
    throw new Error(`${errorLabel} request failed (${response.status}): ${message}`);
  }

  if (response.status === 204) {
    return undefined as unknown as T;
  }

  return (await response.json()) as T;
};

// ---------------------------------------------------------------------------
// Auth headers helper
// ---------------------------------------------------------------------------

export const resolveAuthHeaders = async (auth: AuthModule): Promise<Record<string, string>> => {
  if (auth.getRequestHeaders) {
    return auth.getRequestHeaders();
  }
  const token = await auth.getAccessToken();
  return { Authorization: `Bearer ${token}` };
};

// ---------------------------------------------------------------------------
// Query builder
// ---------------------------------------------------------------------------

export const buildQuery = (entries: readonly (readonly [string, string | undefined])[]): string => {
  const parts: string[] = [];
  for (const [key, value] of entries) {
    if (value !== undefined) {
      parts.push(`${key}=${encodeURIComponent(value)}`);
    }
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
};
