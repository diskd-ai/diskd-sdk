import { createRequire } from 'node:module';
import { createAgentHubClient } from '../agentHub/agentHub.js';
import { createApiKeyAuth } from '../auth/createApiKeyAuth.js';
import { createAuth } from '../auth/createAuth.js';
import { createDriveClient } from '../drive/drive.js';
import { createDriveDatabase } from '../drive/DriveRepository.js';
import type { DriveScopedCrontabClient } from '../drive/crontabTypes.js';
import { createScopedDriveSessionManager } from '../drive/sessionObject.js';
import { createLlmRouterClient } from '../llmRouter/llmRouter.js';
import { createMcpHubClient } from '../mcpHub/mcpHub.js';
import { createTgUserbotClient } from '../tgUserbot/tgUserbot.js';
import { createWebNavigatorClient } from '../webNavigator/webNavigator.js';
import type { DriveDataSource } from '../drive/typeorm/datasourceTypes.js';
import type { DriveDataSourceParams } from '../drive/typeorm/datasourceTypes.js';
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
      const drive = createDriveClient({ version: 'v1', auth, url });
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
      const drive = createDriveClient({ version: 'v1', auth, url });
      return createScopedDriveSessionManager({
        manager: drive.session,
        projectId: scope.projectId,
      });
    },

    crontab: ({ auth, scope, timezone, url }) => {
      const client = createDriveClient({ version: 'v1', auth, url }).crontab;
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
  },

  utils: {
    tgUserBot: ({ auth, workspaceId, url }) => createTgUserbotClient({ auth, workspaceId, url }),

    webNavigator: ({ auth, workspaceId, url }) => createWebNavigatorClient({ auth, workspaceId, url }),
  },
};
