// Domain types for the Agent Hub API.
// These are pure data types only -- no classes, no I/O, no side effects.
//
// Stream event types live in streamProtocolMap.ts and are consumed via
// StreamProtocolHandler (fluent .on() API) and StreamProtocolFetcher
// (SSE stream consumer returning StreamProtocolStream).

import type { StreamProtocolStream } from './StreamProtocolFetcher.js';

// -- Invoke request types --

export type MessageContentTextPart = {
  readonly type: 'text';
  readonly text: string;
};

export type MessageContentImagePart = {
  readonly type: 'image_url';
  readonly imageUrl: string;
};

export type MessageContentPart = MessageContentTextPart | MessageContentImagePart;

export type ChatCompletionMessageParam = {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string | readonly MessageContentPart[];
};

export type AgentInvokeContext = {
  readonly history?: readonly ChatCompletionMessageParam[];
  readonly inodes?: readonly string[];
  readonly user?: {
    readonly id: string;
    readonly name?: string;
    readonly email?: string;
    readonly workspaceId?: string;
  };
  readonly chatSessionId?: string;
};

export type AgentOptions = {
  readonly routeKey?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly maxTokens?: number;
  readonly contextWindow?: number;
  readonly instructions?: string;
  readonly temperature?: number;
  readonly topP?: number;
};

export type AgentHubInvokeParams = {
  readonly agentName: string;
  readonly query: string | readonly MessageContentPart[];
  readonly context?: AgentInvokeContext;
  readonly agentOptions?: AgentOptions;
};

// -- Supported agents --

export type AgentInfo = {
  readonly id: string;
  readonly displayName: string;
};

// -- Supported models --

export type AgentHubModelInfo = {
  readonly provider: string;
  readonly model: string;
  readonly displayName: string;
  readonly description: string;
  readonly supportedTypes?: readonly string[];
  readonly isStreamModel?: boolean;
};

export type SupportedModelsResult = {
  readonly models: readonly AgentHubModelInfo[];
};

// -- Billing aliases --

export type BillingAliasModel = {
  readonly billingAlias: string;
  readonly provider: string;
  readonly model: string;
  readonly displayName: string;
  readonly description: string;
  readonly usedBy: readonly string[];
  readonly supportedTypes: readonly string[];
  readonly isStreamModel: boolean;
};

export type BillingAliasesResult = {
  readonly models: readonly BillingAliasModel[];
  readonly providers: readonly { readonly id: string }[];
  readonly agents: readonly AgentInfo[];
};

// -- Client interface --

/**
 * Agent Hub client organized by namespace.
 *
 * Obtain via `createAgentHubClient`. The `workspaceId` is bound at creation
 * time and forwarded as `X-Workspace-Id` on all requests.
 *
 * The `invoke` method returns a `StreamProtocolStream` for fluent event
 * processing via `StreamProtocolHandler`:
 *
 * ```ts
 * const hub = createAgentHubClient({ auth, workspaceId: 'ws_01...' });
 * const handler = new StreamProtocolHandler()
 *   .on('response.output_text.delta', (e) => process.stdout.write(e.delta))
 *   .on('response.completed', () => console.log('done'))
 *   .on('error', (e) => console.error(e.message));
 *
 * const stream = await hub.invoke({ agentName: 'assistant', query: 'Hello' });
 * stream
 *   .map((event) => handler.handle(event))
 *   .stop(() => console.log('stream closed'))
 *   .catch((err) => console.error(err));
 * ```
 */
export type AgentHubClient = {
  /** POST /invoke -- stream agent response via SSE. Returns a StreamProtocolStream. */
  readonly invoke: (params: AgentHubInvokeParams) => Promise<StreamProtocolStream>;
  readonly agents: {
    /** GET /supported-agents -- list all available agents. */
    readonly list: () => Promise<readonly AgentInfo[]>;
    /** GET /supported-models?agent={id} -- list models supported by an agent. */
    readonly getSupportedModels: (agentId: string) => Promise<SupportedModelsResult>;
  };
  readonly billing: {
    /** GET /billing-aliases -- list billing alias models, providers, and agents. */
    readonly getAliases: () => Promise<BillingAliasesResult>;
  };
};
