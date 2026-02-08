const isObject = (value: unknown): value is { readonly [key: string]: unknown } =>
  typeof value === 'object' && value !== null;

const readOptionalString = (
  obj: { readonly [key: string]: unknown },
  key: string,
): string | undefined => {
  const value = obj[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

const readJsonResponse = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

const describeOAuthError = (data: unknown): string | undefined => {
  if (!isObject(data)) return undefined;
  const error = readOptionalString(data, 'error');
  if (!error) return undefined;
  const description = readOptionalString(data, 'error_description');
  return description ? `${error}: ${description}` : error;
};

const encodeBase64 = (raw: string): string => {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(raw).toString('base64');
  }
  const btoaFn = (globalThis as { btoa?: (data: string) => string }).btoa;
  if (!btoaFn) {
    throw new Error('btoa is unavailable');
  }
  return btoaFn(raw);
};

const readAccessToken = (raw: unknown): string => {
  if (!isObject(raw)) {
    throw new Error('Invalid token response: expected object');
  }
  const token = readOptionalString(raw, 'access_token');
  if (!token) {
    throw new Error('Invalid token response: access_token is required');
  }
  return token;
};

export const requestClientCredentialsToken = async (params: {
  readonly tokenEndpoint: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly audience: string;
  readonly scopes: readonly string[];
}): Promise<string> => {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: params.clientId,
    scope: params.scopes.join(' '),
    audience: params.audience,
  });

  const basic = encodeBase64(`${params.clientId}:${params.clientSecret}`);
  const response = await fetch(params.tokenEndpoint, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const data: unknown = await readJsonResponse(response);
  if (!response.ok) {
    const detail = describeOAuthError(data);
    throw new Error(`Token request failed: HTTP ${response.status}${detail ? ` (${detail})` : ''}`);
  }
  return readAccessToken(data);
};

export const requestAuthorizationCodeToken = async (params: {
  readonly tokenEndpoint: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly code: string;
  readonly verifier: string;
}): Promise<string> => {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    code: params.code,
    code_verifier: params.verifier,
  });

  const response = await fetch(params.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const data: unknown = await readJsonResponse(response);
  if (!response.ok) {
    const detail = describeOAuthError(data);
    throw new Error(`Token request failed: HTTP ${response.status}${detail ? ` (${detail})` : ''}`);
  }
  return readAccessToken(data);
};
