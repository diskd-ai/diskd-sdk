type KeyfileJson = {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly audience: string;
  readonly apisUrl?: string;
};

const isObject = (value: unknown): value is { readonly [key: string]: unknown } =>
  typeof value === 'object' && value !== null;

const readRequiredString = (obj: { readonly [key: string]: unknown }, key: string): string => {
  const value = obj[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid credentials.json: '${key}' must be a non-empty string`);
  }
  return value;
};

const readOptionalString = (obj: { readonly [key: string]: unknown }, key: string): string | undefined => {
  const value = obj[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

export const readKeyfileFromPath = async (keyfilePath: string): Promise<KeyfileJson> => {
  const fs = await import('node:fs/promises');
  const rawText = await fs.readFile(keyfilePath, 'utf-8');
  const data: unknown = JSON.parse(rawText);
  if (!isObject(data)) {
    throw new Error('Invalid credentials.json: expected object');
  }
  return {
    issuer: readRequiredString(data, 'issuer'),
    clientId: readRequiredString(data, 'clientId'),
    clientSecret: readRequiredString(data, 'clientSecret'),
    audience: readRequiredString(data, 'audience'),
    apisUrl: readOptionalString(data, 'apisUrl'),
  };
};
