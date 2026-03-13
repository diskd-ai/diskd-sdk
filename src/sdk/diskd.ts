import { createRequire } from 'node:module';
import { createAgentHubClient } from '../agentHub/agentHub.js';
import { createApiKeyAuth } from '../auth/createApiKeyAuth.js';
import { createAuth } from '../auth/createAuth.js';
import { createDriveClient } from '../drive/drive.js';
import { createDriveDatabase } from '../drive/DriveRepository.js';
import { createLlmRouterClient } from '../llmRouter/llmRouter.js';
import { createMcpHubClient } from '../mcpHub/mcpHub.js';
import { createTgUserbotClient } from '../tgUserbot/tgUserbot.js';
import { createWebNavigatorClient } from '../webNavigator/webNavigator.js';
import type { DriveDataSource } from '../drive/typeorm/datasourceTypes.js';
import type { DriveDataSourceParams } from '../drive/typeorm/datasourceTypes.js';
import type { DiskD } from './types.js';

const require = createRequire(import.meta.url);

export const diskd: DiskD = {
  auth: {
    apiKey: (params) => createApiKeyAuth(params),
    credentials: (params) => createAuth(params),
  },

  drive: ({ version, auth, url }) => {
    if (version !== 'v1') {
      throw new Error('Unsupported Drive API version');
    }
    return createDriveClient({ version, auth, url });
  },

  session: ({ auth, url }) => createDriveClient({ version: 'v1', auth, url }).session,

  crontab: ({ auth, url }) => createDriveClient({ version: 'v1', auth, url }).crontab,

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

  mcpHub: ({ auth, workspaceId, url }) => createMcpHubClient({ auth, workspaceId, url }),

  agentHub: ({ auth, workspaceId, url }) => createAgentHubClient({ auth, workspaceId, url }),

  tgUserbot: ({ auth, workspaceId, url }) => createTgUserbotClient({ auth, workspaceId, url }),

  webNavigator: ({ auth, workspaceId, url }) => createWebNavigatorClient({ auth, workspaceId, url }),
};
