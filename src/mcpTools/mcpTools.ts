// MCP Tools gateway client -- JSON-RPC transport with automatic session management.
//
// Communicates with the public APIS MCP gateway at POST /v1/os/mcp by default,
// or directly to MCP Hub at POST /v1/mcp when given a host-only override.
// Session lifecycle (initialize handshake, mcp-session-id reuse) is handled
// internally so consumers only see list/find/call.

import type { AuthModule } from '../auth/types.js';
import { resolveDiskdGatewayUrl } from '../env/baseUrl.js';
import type { McpGatewayTool, McpToolCallResult, McpToolsClient } from './mcpToolsTypes.js';

// ---------------------------------------------------------------------------
// JSON-RPC internal types (not exported)
// ---------------------------------------------------------------------------

type JsonRpcRequest = {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly method: string;
  readonly params?: unknown;
};

type JsonRpcResponse = {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly result?: unknown;
  readonly error?: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
};

// ---------------------------------------------------------------------------
// Pure helper
// ---------------------------------------------------------------------------

/**
 * Construct a fully-qualified MCP tool name from namespace and tool name.
 *
 * MCP Hub uses double-underscore to separate the server's instance namespace
 * from the raw tool name: `{instanceNamespace}__{toolName}`.
 */
export const mcpToolName = (instanceNamespace: string, toolName: string): string =>
  `${instanceNamespace}__${toolName}`;

// ---------------------------------------------------------------------------
// Gateway URL derivation
// ---------------------------------------------------------------------------

const deriveGatewayUrl = (baseUrlOrUndefined: string | undefined): string => {
  if (baseUrlOrUndefined === undefined) {
    return resolveDiskdGatewayUrl('os/mcp');
  }

  const base = baseUrlOrUndefined.replace(/\/+$/, '');
  const url = new URL(base);
  return url.pathname === '' || url.pathname === '/' ? `${url.origin}/v1/mcp` : base;
};

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

/**
 * Creates an MCP Tools gateway client for listing and invoking MCP tools.
 *
 * The client talks to the public APIS MCP gateway endpoint (`POST /v1/os/mcp`)
 * by default. When `url` is a direct MCP Hub host override, it targets
 * `POST /v1/mcp` on that host.
 *
 * Session initialization is lazy -- the first call triggers the MCP `initialize`
 * handshake and captures the `mcp-session-id` header.
 *
 * Example:
 * ```ts
 * const tools = createMcpToolsClient({ auth });
 * const all = await tools.list();
 * const result = await tools.call('github__list_repos', { username: 'octocat' });
 * ```
 */
export const createMcpToolsClient = (params: {
  readonly auth: AuthModule;
  readonly url?: string;
}): McpToolsClient => {
  const gatewayUrl = deriveGatewayUrl(params.url);

  // Mutable session state (closure-scoped, not shared)
  let sessionId: string | undefined;
  let initialized = false;
  let nextId = 1;

  // -- Auth headers --

  const getAuthHeaders = async (): Promise<Record<string, string>> => {
    if (params.auth.getRequestHeaders) {
      return params.auth.getRequestHeaders();
    }
    const token = await params.auth.getAccessToken();
    return { Authorization: `Bearer ${token}` };
  };

  // -- JSON-RPC transport --

  const sendJsonRpc = async (method: string, rpcParams?: unknown): Promise<unknown> => {
    const authHeaders = await getAuthHeaders();
    const workspaceId = await params.auth.getWorkspaceId();

    const body: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: nextId++,
      method,
      ...(rpcParams !== undefined ? { params: rpcParams } : {}),
    };

    const headers: Record<string, string> = {
      ...authHeaders,
      'Content-Type': 'application/json',
    };

    if (workspaceId) {
      headers['X-Workspace-Id'] = workspaceId;
    }

    if (sessionId) {
      headers['mcp-session-id'] = sessionId;
    }

    const response = await fetch(gatewayUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const errorData = (await response.json()) as Record<string, unknown>;
        if (typeof errorData.message === 'string') {
          message = errorData.message;
        }
      } catch {
        // Could not parse error body
      }
      throw new Error(`MCP Tools request failed (${response.status}): ${message}`);
    }

    // Capture session ID from response header
    const newSessionId = response.headers.get('mcp-session-id');
    if (newSessionId) {
      sessionId = newSessionId;
    }

    const rpcResponse = (await response.json()) as JsonRpcResponse;

    if (rpcResponse.error) {
      throw new Error(
        `MCP Tools JSON-RPC error (${rpcResponse.error.code}): ${rpcResponse.error.message}`
      );
    }

    return rpcResponse.result;
  };

  // -- Session lifecycle --

  const ensureInitialized = async (): Promise<void> => {
    if (initialized) return;

    await sendJsonRpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: '@diskd-ai/sdk', version: '1.0.0' },
    });

    initialized = true;
  };

  // -- Public API --

  const list = async (): Promise<readonly McpGatewayTool[]> => {
    await ensureInitialized();
    const result = (await sendJsonRpc('tools/list')) as {
      readonly tools: readonly McpGatewayTool[];
    };
    return result.tools;
  };

  const find = async (pattern: string): Promise<readonly McpGatewayTool[]> => {
    const tools = await list();
    const regex = new RegExp(pattern, 'i');
    return tools.filter((t) => regex.test(t.name) || regex.test(t.description));
  };

  const call = async (
    name: string,
    args?: Readonly<Record<string, unknown>>
  ): Promise<McpToolCallResult> => {
    await ensureInitialized();
    const result = (await sendJsonRpc('tools/call', {
      name,
      arguments: args ?? {},
    })) as McpToolCallResult;
    return result;
  };

  return { list, find, call };
};
