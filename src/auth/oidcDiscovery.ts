type OidcDiscoveryDocument = {
  readonly issuer: string;
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly userinfo_endpoint?: string;
};

const isObject = (value: unknown): value is { readonly [key: string]: unknown } =>
  typeof value === 'object' && value !== null;

const readRequiredString = (obj: { readonly [key: string]: unknown }, key: string): string => {
  const value = obj[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid discovery document: '${key}' must be a non-empty string`);
  }
  return value;
};

const readOptionalString = (
  obj: { readonly [key: string]: unknown },
  key: string
): string | undefined => {
  const value = obj[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

export const fetchOidcDiscovery = async (issuer: string): Promise<OidcDiscoveryDocument> => {
  const url = `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`;
  const response = await fetch(url);
  const data: unknown = await response.json();
  if (!isObject(data)) {
    throw new Error('Invalid discovery document: expected object');
  }
  return {
    issuer: readRequiredString(data, 'issuer'),
    authorization_endpoint: readRequiredString(data, 'authorization_endpoint'),
    token_endpoint: readRequiredString(data, 'token_endpoint'),
    userinfo_endpoint: readOptionalString(data, 'userinfo_endpoint'),
  };
};
