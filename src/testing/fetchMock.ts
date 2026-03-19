export type FetchCall = {
  readonly url: string;
  readonly init?: RequestInit;
};

export type FetchHandler = (url: string, init?: RequestInit) => Response;

/**
 * Replace globalThis.fetch for the duration of `fn`, restoring it afterward.
 * The handler receives the normalized URL string and init.
 * The calls array collects every request for assertions.
 */
export const withFetchMock = async (
  handler: FetchHandler,
  fn: (calls: FetchCall[]) => Promise<void>
): Promise<void> => {
  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    return handler(url, init);
  };
  (globalThis as { fetch: typeof fetch }).fetch = fetchMock;
  try {
    await fn(calls);
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  }
};

/**
 * Run `fn` with the given env vars set, restoring originals afterward.
 * Keys whose original value was undefined are deleted after the test.
 */
export const withEnv = async (
  vars: Readonly<Record<string, string>>,
  fn: () => Promise<void>
): Promise<void> => {
  const originals: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    originals[key] = process.env[key];
    process.env[key] = vars[key];
  }
  try {
    await fn();
  } finally {
    for (const [key, original] of Object.entries(originals)) {
      if (original === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
    }
  }
};
