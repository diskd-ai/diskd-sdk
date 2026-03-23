const readEnvString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const stripTrailingSlashes = (value: string): string => value.replace(/\/+$/, '');

const stripSurroundingSlashes = (value: string): string => value.replace(/^\/+|\/+$/g, '');

export const resolveDiskdBaseUrl = (): string => {
  const nodeEnv = readEnvString(
    (globalThis as { process?: { env?: { APIS_BASE_URL?: string } } }).process?.env?.APIS_BASE_URL
  );
  if (nodeEnv) return nodeEnv;

  const runtime = readEnvString((globalThis as { APIS_BASE_URL?: unknown }).APIS_BASE_URL);
  if (runtime) return runtime;

  throw new Error('APIS_BASE_URL is not set.');
};

export const resolveDiskdGatewayUrl = (pathPrefix: string): string => {
  const normalizedPrefix = stripSurroundingSlashes(pathPrefix);
  const baseUrl = stripTrailingSlashes(resolveDiskdBaseUrl());
  return normalizedPrefix.length > 0 ? `${baseUrl}/${normalizedPrefix}` : baseUrl;
};
