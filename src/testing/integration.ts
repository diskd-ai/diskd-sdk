// -- OAuth2 keyfile auth (external) --

export type IntegrationEnv = {
  readonly credentialsPath: string;
  readonly baseUrl: string;
};

export type IntegrationCheck =
  | { readonly tag: 'Ready'; readonly env: IntegrationEnv }
  | { readonly tag: 'Skip'; readonly reason: string };

/**
 * Check whether OAuth2 keyfile integration env vars are available.
 * Returns a discriminated union so tests can skip or proceed.
 */
export const checkIntegrationEnv = (): IntegrationCheck => {
  const credentialsPath = process.env.DISKD_CREDENTIALS_PATH;
  const baseUrl = process.env.DISKD_BASE_URL;

  if (!credentialsPath || credentialsPath.trim().length === 0) {
    return { tag: 'Skip', reason: 'Set DISKD_CREDENTIALS_PATH to run integration tests' };
  }
  if (!baseUrl || baseUrl.trim().length === 0) {
    return { tag: 'Skip', reason: 'Set DISKD_BASE_URL to run integration tests' };
  }
  return { tag: 'Ready', env: { credentialsPath, baseUrl } };
};

// -- API key auth (internal / Tilt) --

export type ApiKeyEnv = {
  readonly apiKey: string;
  readonly workspaceId: string;
};

export type ApiKeyCheck =
  | { readonly tag: 'Ready'; readonly env: ApiKeyEnv }
  | { readonly tag: 'Skip'; readonly reason: string };

/**
 * Check whether API key integration env vars are available.
 * Use this for Tilt-based smoke tests with internal service auth.
 */
export const checkApiKeyEnv = (): ApiKeyCheck => {
  const apiKey = process.env.DISKD_API_KEY;
  const workspaceId = process.env.DISKD_WORKSPACE_ID;

  if (!apiKey || apiKey.trim().length === 0) {
    return { tag: 'Skip', reason: 'Set DISKD_API_KEY to run integration tests' };
  }
  if (!workspaceId || workspaceId.trim().length === 0) {
    return { tag: 'Skip', reason: 'Set DISKD_WORKSPACE_ID to run integration tests' };
  }
  return { tag: 'Ready', env: { apiKey, workspaceId } };
};
