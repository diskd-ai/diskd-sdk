// Domain types for the MCP Tools gateway client.
// These are pure data types only -- no classes, no I/O, no side effects.
// The MCP Hub JSON-RPC gateway returns camelCase; no wire-level conversion needed.

// -- MCP Gateway tool (from tools/list response) --

export type McpGatewayToolInputSchema = {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required?: readonly string[];
  readonly [key: string]: unknown;
};

export type McpGatewayTool = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: McpGatewayToolInputSchema;
};

// -- Tool call content and result --

export type McpToolCallContentItem =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly data: string; readonly mimeType: string }
  | {
      readonly type: 'resource';
      readonly resource: {
        readonly uri: string;
        readonly text?: string;
        readonly blob?: string;
      };
    };

export type McpToolCallResult = {
  readonly content: readonly McpToolCallContentItem[];
  readonly isError?: boolean;
};

// -- Client interface --

/**
 * MCP Tools gateway client for listing and invoking MCP tools via JSON-RPC.
 *
 * Obtain via `diskd.os.mcpTools({ auth })`. Session lifecycle (initialize
 * handshake, session ID reuse) is managed transparently.
 */
export type McpToolsClient = {
  /** List all available tools across installed MCP servers. */
  readonly list: () => Promise<readonly McpGatewayTool[]>;
  /** Find tools matching a regex pattern (client-side filter on name + description). */
  readonly find: (pattern: string) => Promise<readonly McpGatewayTool[]>;
  /** Call a tool by its fully-qualified namespaced name. */
  readonly call: (
    name: string,
    args?: Readonly<Record<string, unknown>>
  ) => Promise<McpToolCallResult>;
};
