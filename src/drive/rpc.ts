/** A JSON-RPC failure with transport status kept separate from the RPC code. */
export class JsonRpcError extends Error {
  readonly code?: number;
  readonly httpStatus: number;
  readonly data?: unknown;

  constructor(
    message: string,
    details: { readonly code?: number; readonly httpStatus: number; readonly data?: unknown }
  ) {
    super(message);
    this.name = 'JsonRpcError';
    this.code = details.code;
    this.httpStatus = details.httpStatus;
    this.data = details.data;
  }
}

type JsonRpcRequest = {
  readonly jsonrpc: '2.0';
  readonly method: string;
  readonly params: unknown;
  readonly id: number;
};

type JsonRpcResponse = {
  readonly jsonrpc?: '2.0';
  readonly result?: unknown;
  readonly error?: unknown;
  readonly id?: number;
};

const isObject = (value: unknown): value is { readonly [key: string]: unknown } =>
  typeof value === 'object' && value !== null;

const readJsonResponse = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    const snippet = text.length > 200 ? `${text.slice(0, 200)}…` : text;
    const message = `Invalid JSON-RPC response: expected JSON (HTTP ${response.status}): ${snippet}`;
    throw response.ok
      ? new Error(message)
      : new JsonRpcError(message, { httpStatus: response.status });
  }
};

export type JsonRpcCallParams = {
  readonly url: string;
  readonly method: string;
  readonly rpcParams: unknown;
  readonly id: number;
  /** Caller-owned cancellation for the exact HTTP request. */
  readonly signal?: AbortSignal;
} & (
  | { readonly bearerToken: string; readonly headers?: undefined }
  | { readonly headers: Readonly<Record<string, string>>; readonly bearerToken?: undefined }
);

export const jsonRpcCall = async (params: JsonRpcCallParams): Promise<unknown> => {
  const payload: JsonRpcRequest = {
    jsonrpc: '2.0',
    method: params.method,
    params: params.rpcParams,
    id: params.id,
  };

  const authHeaders: Record<string, string> = params.headers
    ? { ...params.headers }
    : { Authorization: `Bearer ${params.bearerToken}` };

  const response = await fetch(params.url, {
    method: 'POST',
    headers: {
      ...authHeaders,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: params.signal,
  });

  const body: unknown = await readJsonResponse(response);
  if (!isObject(body)) {
    const message = 'Invalid JSON-RPC response: expected object';
    throw response.ok
      ? new Error(message)
      : new JsonRpcError(message, { httpStatus: response.status });
  }

  const rpc = body as JsonRpcResponse;
  if (!response.ok) {
    if (rpc.error) {
      throw _makeRpcError(
        `JSON-RPC HTTP ${response.status}: ${JSON.stringify(rpc.error)}`,
        response.status,
        rpc.error
      );
    }
    throw new JsonRpcError(`JSON-RPC HTTP ${response.status}`, { httpStatus: response.status });
  }
  if (rpc.error) {
    throw _makeRpcError(`JSON-RPC error: ${JSON.stringify(rpc.error)}`, response.status, rpc.error);
  }
  return rpc.result;
};

const _makeRpcError = (message: string, httpStatus: number, rawError: unknown): JsonRpcError => {
  if (!isObject(rawError) || Array.isArray(rawError)) {
    return new JsonRpcError(message, { httpStatus });
  }
  const code = Object.hasOwn(rawError, 'code') ? rawError.code : undefined;
  return new JsonRpcError(message, {
    httpStatus,
    ...(typeof code === 'number' && Number.isSafeInteger(code) ? { code } : {}),
    ...(Object.hasOwn(rawError, 'data') ? { data: rawError.data } : {}),
  });
};
