/** Create a JSON-RPC 2.0 success Response. */
export const jsonRpcResponse = (result: unknown, sessionId?: string): Response => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (sessionId) {
    headers['mcp-session-id'] = sessionId;
  }
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), {
    status: 200,
    headers,
  });
};

/** Create a JSON-RPC 2.0 error Response. */
export const jsonRpcError = (code: number, message: string): Response =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code, message } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

/** Parse the JSON body from a RequestInit. */
export const parseBody = (init?: RequestInit): Record<string, unknown> =>
  JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>;

/** Create a simple JSON Response (for REST mocks). */
export const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
