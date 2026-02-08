const readEnvString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

export const resolveDiskdBaseUrl = (): string => {
  const nodeEnv = readEnvString(
    (globalThis as { process?: { env?: { DISKD_BASE_URL?: string } } }).process?.env?.DISKD_BASE_URL,
  );
  if (nodeEnv) return nodeEnv;

  const runtime = readEnvString((globalThis as { DISKD_BASE_URL?: unknown }).DISKD_BASE_URL);
  if (runtime) return runtime;

  return 'https://apis.diskd.local:8080';
};

