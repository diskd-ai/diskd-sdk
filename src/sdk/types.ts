import type { AgentHubClient } from '../agentHub/agentHubTypes.js';
import type { ApiKeyAuthParams, AuthModule, SdkCreateParams } from '../auth/types.js';
import type { CalendarClient } from '../calendar/calendarTypes.js';
import type { ContactsClient } from '../contacts/contactsTypes.js';
import type { DriveCrontabScopeRef, DriveScopedCrontabClient } from '../drive/crontabTypes.js';
import type { DriveDatabase, DriveDatabaseParams } from '../drive/DriveRepository.js';
import type { DriveScopedSessionManager } from '../drive/sessionObject.js';
import type { DriveSessionScopeRef } from '../drive/sessionTypes.js';
import type { DriveDataSource, DriveDataSourceParams } from '../drive/typeorm/datasourceTypes.js';
import type { DriveClient } from '../drive/types.js';
import type { LlmRouterClient } from '../llmRouter/llmRouterTypes.js';
import type { McpHubClient } from '../mcpHub/mcpHubTypes.js';
import type { McpToolsClient } from '../mcpTools/mcpToolsTypes.js';
import type { MessagesStoreClient } from '../messagesStore/messagesStoreTypes.js';
import type { OperativesClient } from '../operatives/operativesTypes.js';
import type { PlatformEventsClient } from '../platformEvents/platformEventsTypes.js';
import type { ProjectsClient } from '../projects/projectsTypes.js';
import type { RoutineRunsClient } from '../routineRuns/routineRunsTypes.js';
import type { RoutinesClient } from '../routines/routinesTypes.js';
import type { TgUserbotClient } from '../tgUserbot/tgUserbotTypes.js';
import type { WebNavigatorClient } from '../webNavigator/webNavigatorTypes.js';

export type DiskD = {
  /** Auth factory methods. */
  readonly auth: {
    /** Create an AuthModule for internal service-to-service communication (uses APIS_API_KEY from env). */
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

    readonly mcp: (params: { readonly auth: AuthModule; readonly url?: string }) => McpHubClient;

    readonly mcpTools: (params: {
      readonly auth: AuthModule;
      readonly url?: string;
    }) => McpToolsClient;

    readonly agents: (params: {
      readonly auth: AuthModule;
      readonly url?: string;
    }) => AgentHubClient;

    readonly messagesStore: (params: {
      readonly auth: AuthModule;
      readonly url?: string;
    }) => MessagesStoreClient;
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

    readonly routineRuns: (params: {
      readonly auth: AuthModule;
      readonly url?: string;
    }) => RoutineRunsClient;

    readonly routines: (params: {
      readonly auth: AuthModule;
      readonly url?: string;
    }) => RoutinesClient;

    readonly operatives: (params: {
      readonly auth: AuthModule;
      readonly url?: string;
    }) => OperativesClient;

    readonly projects: (params: {
      readonly auth: AuthModule;
      readonly url?: string;
    }) => ProjectsClient;

    readonly events: (params: {
      readonly auth: AuthModule;
      readonly url?: string;
    }) => PlatformEventsClient;

    readonly calendar: (params: {
      readonly auth: AuthModule;
      readonly url?: string;
    }) => CalendarClient;

    readonly contacts: (params: {
      readonly auth: AuthModule;
      readonly url?: string;
    }) => ContactsClient;
  };

  readonly utils: {
    readonly tgUserBot: (params: {
      readonly auth: AuthModule;
      readonly url?: string;
    }) => TgUserbotClient;

    readonly webNavigator: (params: {
      readonly auth: AuthModule;
      readonly url?: string;
    }) => WebNavigatorClient;
  };
};
