import { createRequire } from 'node:module';
import { createAgentHubClient } from '../agentHub/agentHub.js';
import { createApiKeyAuth } from '../auth/createApiKeyAuth.js';
import { createAuth } from '../auth/createAuth.js';
import type { DriveScopedCrontabClient } from '../drive/crontabTypes.js';
import { createDriveDatabase } from '../drive/DriveRepository.js';
import { createDriveClient } from '../drive/drive.js';
import { createScopedDriveSessionManager } from '../drive/sessionObject.js';
import type { DriveDataSource, DriveDataSourceParams } from '../drive/typeorm/datasourceTypes.js';
import { resolveDiskdGatewayUrl } from '../env/baseUrl.js';
import { createLlmRouterClient } from '../llmRouter/llmRouter.js';
import { createMcpHubClient } from '../mcpHub/mcpHub.js';
import { createOperativesClient } from '../operatives/operatives.js';
import { createRoutinesClient } from '../routines/routines.js';
import { createTgUserbotClient } from '../tgUserbot/tgUserbot.js';
import { createWebNavigatorClient } from '../webNavigator/webNavigator.js';
import type { DiskD } from './types.js';

const require = createRequire(import.meta.url);

const resolveDefaultTimezone = (timezone: string | null | undefined): string | null => {
  if (timezone !== undefined) {
    return timezone;
  }

  const callerTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return typeof callerTimezone === 'string' && callerTimezone.length > 0 ? callerTimezone : null;
};

export const diskd: DiskD = {
  auth: {
    apiKey: (params) => createApiKeyAuth(params),
    credentials: (params) => createAuth(params),
  },

  os: {
    drive: ({ version, auth, url }) => {
      if (version !== 'v1') {
        throw new Error('Unsupported Drive API version');
      }
      return createDriveClient({ version, auth, url });
    },

    database: ({ auth, url, dbName, dbType, schema }) => {
      const dbUrl = url ?? `${resolveDiskdGatewayUrl('os/database')}/api/v1`;
      const drive = createDriveClient({ version: 'v1', auth, url: dbUrl });
      return createDriveDatabase({ db: drive.db, dbName, dbType, schema });
    },

    datasource: (params) => {
      // Lazy-load typeorm-dependent code so consumers without typeorm are not affected.
      const { createDriveDataSource } = require('../drive/typeorm/createDriveDataSource.js') as {
        createDriveDataSource: (p: DriveDataSourceParams) => unknown;
      };
      return createDriveDataSource(params) as DriveDataSource;
    },

    llm: ({ auth, url }) => createLlmRouterClient({ auth, url }),

    mcp: ({ auth, workspaceId, url }) => createMcpHubClient({ auth, workspaceId, url }),

    agents: ({ auth, workspaceId, url }) => createAgentHubClient({ auth, workspaceId, url }),
  },

  platform: {
    sessions: ({ auth, scope, url }) => {
      const sessionUrl = url ?? `${resolveDiskdGatewayUrl('platform/sessions')}/api/v1`;
      const drive = createDriveClient({ version: 'v1', auth, url: sessionUrl });
      return createScopedDriveSessionManager({
        manager: drive.session,
        projectId: scope.projectId,
      });
    },

    crontab: ({ auth, scope, timezone, url }) => {
      const crontabUrl = url ?? `${resolveDiskdGatewayUrl('platform/crontab')}/api/v1`;
      const client = createDriveClient({ version: 'v1', auth, url: crontabUrl }).crontab;
      const effectiveTimezone = resolveDefaultTimezone(timezone);
      const scopedClient: DriveScopedCrontabClient = {
        save: async ({ jobs }) => {
          return client.save({
            scope,
            document: {
              version: 1,
              timezone: effectiveTimezone,
              jobs,
            },
          });
        },

        get: async () => {
          return client.get({ scope });
        },

        getStatus: async () => {
          return client.getStatus({ scope });
        },

        createJob: async ({ job }) => {
          if (scope.scopeType === 'project') {
            return client.createProjectJob({
              projectId: scope.projectId,
              job,
              timezone: effectiveTimezone,
            });
          }
          return client.createProfileJob({
            job,
            timezone: effectiveTimezone,
          });
        },

        listJobs: async () => {
          return client.listJobs({ scope });
        },

        runJob: async (params) => {
          return client.runJob(params);
        },
      };

      return scopedClient;
    },

    routines: ({ auth, url }) => createRoutinesClient({ auth, url }),

    operatives: ({ auth, url }) => createOperativesClient({ auth, url }),
  },

  utils: {
    tgUserBot: ({ auth, workspaceId, url }) => createTgUserbotClient({ auth, workspaceId, url }),

    webNavigator: ({ auth, workspaceId, url }) =>
      createWebNavigatorClient({ auth, workspaceId, url }),
  },
};
