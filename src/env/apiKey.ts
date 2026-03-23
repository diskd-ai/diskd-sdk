const readEnvString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

export const resolveApisApiKey = (): string => {
  const nodeEnv = readEnvString(
    (globalThis as { process?: { env?: { APIS_API_KEY?: string } } }).process?.env?.APIS_API_KEY
  );
  if (nodeEnv) return nodeEnv;

  const runtime = readEnvString((globalThis as { APIS_API_KEY?: unknown }).APIS_API_KEY);
  if (runtime) return runtime;

  throw new Error('APIS_API_KEY is not set.');
};
