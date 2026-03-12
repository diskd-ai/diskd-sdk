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
    throw new Error(`Invalid JSON-RPC response: expected JSON (HTTP ${response.status}): ${snippet}`);
  }
};

export type JsonRpcCallParams = {
  readonly url: string;
  readonly method: string;
  readonly rpcParams: unknown;
  readonly id: number;
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
  });

  const body: unknown = await readJsonResponse(response);
  if (!isObject(body)) {
    throw new Error('Invalid JSON-RPC response: expected object');
  }

  const rpc = body as JsonRpcResponse;
  if (!response.ok) {
    if (rpc.error) {
      throw new Error(`JSON-RPC HTTP ${response.status}: ${JSON.stringify(rpc.error)}`);
    }
    throw new Error(`JSON-RPC HTTP ${response.status}`);
  }
  if (rpc.error) {
    throw new Error(`JSON-RPC error: ${JSON.stringify(rpc.error)}`);
  }
  return rpc.result;
};
