const isObject = (value) => typeof value === 'object' && value !== null;
const readJsonResponse = async (response) => {
    const text = await response.text();
    if (text.length === 0)
        return null;
    try {
        return JSON.parse(text);
    }
    catch {
        const snippet = text.length > 200 ? `${text.slice(0, 200)}…` : text;
        throw new Error(`Invalid JSON-RPC response: expected JSON (HTTP ${response.status}): ${snippet}`);
    }
};
export const jsonRpcCall = async (params) => {
    const payload = {
        jsonrpc: '2.0',
        method: params.method,
        params: params.rpcParams,
        id: params.id,
    };
    const authHeaders = params.headers
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
    const body = await readJsonResponse(response);
    if (!isObject(body)) {
        throw new Error('Invalid JSON-RPC response: expected object');
    }
    const rpc = body;
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
