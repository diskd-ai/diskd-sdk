import type { AgentHubClient } from '../agentHub/agentHubTypes.js';
import type { AuthModule } from '../auth/types.js';
import type { DriveClient } from '../drive/types.js';
import type { LlmRouterClient } from '../llmRouter/llmRouterTypes.js';
import type { McpHubClient } from '../mcpHub/mcpHubTypes.js';
import type { TgUserbotClient } from '../tgUserbot/tgUserbotTypes.js';
import type { WebNavigatorClient } from '../webNavigator/webNavigatorTypes.js';

export type DiskD = {
  readonly drive: (params: {
    readonly version: 'v1';
    readonly auth: AuthModule;
    readonly url?: string;
  }) => DriveClient;

  readonly llm: (params: {
    readonly auth: AuthModule;
    readonly url?: string;
  }) => LlmRouterClient;

  readonly mcpHub: (params: {
    readonly auth: AuthModule;
    readonly workspaceId: string;
    readonly url?: string;
  }) => McpHubClient;

  readonly agentHub: (params: {
    readonly auth: AuthModule;
    readonly workspaceId: string;
    readonly url?: string;
  }) => AgentHubClient;

  readonly tgUserbot: (params: {
    readonly auth: AuthModule;
    readonly workspaceId: string;
    readonly url?: string;
  }) => TgUserbotClient;

  readonly webNavigator: (params: {
    readonly auth: AuthModule;
    readonly workspaceId: string;
    readonly url?: string;
  }) => WebNavigatorClient;
};

