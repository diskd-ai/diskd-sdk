import { resolveDiskdBaseUrl } from '../env/baseUrl.js';
import type { ApiKeyAuthParams, AuthModule } from './types.js';

/**
 * Creates an AuthModule for internal service-to-service communication
 * using API key + workspace identity headers.
 *
 * Use this for services running inside the cluster or connecting
 * to localhost port-forwards. For external clients, use createAuth()
 * with OAuth2 credentials instead.
 */
export const createApiKeyAuth = (params: ApiKeyAuthParams): AuthModule => {
  if (params.apiKey.length === 0) {
    throw new Error('APIS_API_KEY is not set.');
  }

  // API-key auth is only supported through the APIS gateway contract.
  resolveDiskdBaseUrl();

  const headers: Readonly<Record<string, string>> = {
    'X-Api-Key': params.apiKey,
    'X-Workspace-Id': params.workspaceId,
    'X-User-Id': params.userId ?? params.workspaceId,
    'X-Organization-Id': params.orgId ?? params.workspaceId,
  };

  return {
    signIn: async () => {},
    signOut: () => {},
    handleRedirectCallback: async () => {},
    getAccessToken: async () => params.apiKey,
    getToken: () => ({ accessToken: params.apiKey }),
    getWorkspaceId: async () => params.workspaceId,
    getRequestHeaders: async () => headers,
  };
};
