import type { AgentHubClient } from '../agentHub/agentHubTypes.js';
import type { ApiKeyAuthParams, AuthModule, SdkCreateParams } from '../auth/types.js';
import type { DriveCrontabScopeRef, DriveScopedCrontabClient } from '../drive/crontabTypes.js';
import type { DriveDatabase, DriveDatabaseParams } from '../drive/DriveRepository.js';
import type { DriveScopedSessionManager } from '../drive/sessionObject.js';
import type { DriveSessionScopeRef } from '../drive/sessionTypes.js';
import type { DriveDataSource, DriveDataSourceParams } from '../drive/typeorm/datasourceTypes.js';
import type { DriveClient } from '../drive/types.js';
import type { LlmRouterClient } from '../llmRouter/llmRouterTypes.js';
import type { McpHubClient } from '../mcpHub/mcpHubTypes.js';
import type { OperativesClient } from '../operatives/operativesTypes.js';
import type { RoutinesClient } from '../routines/routinesTypes.js';
import type { TgUserbotClient } from '../tgUserbot/tgUserbotTypes.js';
import type { WebNavigatorClient } from '../webNavigator/webNavigatorTypes.js';

export type DiskD = {
  /** Auth factory methods. */
  readonly auth: {
    /** Create an AuthModule for internal service-to-service communication (API key). */
    readonly apiKey: (params: ApiKeyAuthParams) => AuthModule;
    /** Create an AuthModule for external clients (OAuth2 service-account or PKCE). */
    readonly credentials: (params: SdkCreateParams) => Promise<AuthModule>;
  };

  readonly os: {
    readonly drive: (params: {
      readonly version: 'v1';
      readonly auth: AuthModule;
      readonly url?: string;
    }) => DriveClient;

    readonly database: (
      params: DriveDatabaseParams & {
        readonly auth: AuthModule;
        readonly url?: string;
      }
    ) => DriveDatabase;

    /** Create a TypeORM DataSource backed by Drive DB (requires `typeorm` peer). */
    readonly datasource: (params: DriveDataSourceParams) => DriveDataSource;

    readonly llm: (params: { readonly auth: AuthModule; readonly url?: string }) => LlmRouterClient;

    readonly mcp: (params: {
      readonly auth: AuthModule;
      readonly workspaceId: string;
      readonly url?: string;
    }) => McpHubClient;

    readonly agents: (params: {
      readonly auth: AuthModule;
      readonly workspaceId: string;
      readonly url?: string;
    }) => AgentHubClient;
  };

  readonly platform: {
    readonly sessions: (params: {
      readonly auth: AuthModule;
      readonly scope: DriveSessionScopeRef;
      readonly url?: string;
    }) => DriveScopedSessionManager;

    readonly crontab: (params: {
      readonly auth: AuthModule;
      readonly scope: DriveCrontabScopeRef;
      readonly timezone?: string | null;
      readonly url?: string;
    }) => DriveScopedCrontabClient;

    readonly routines: (params: {
      readonly auth: AuthModule;
      readonly url?: string;
    }) => RoutinesClient;

    readonly operatives: (params: {
      readonly auth: AuthModule;
      readonly url?: string;
    }) => OperativesClient;
  };

  readonly utils: {
    readonly tgUserBot: (params: {
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
};
