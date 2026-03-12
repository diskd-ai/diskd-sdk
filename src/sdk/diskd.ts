import { createAgentHubClient } from '../agentHub/agentHub.js';
import { createDriveClient } from '../drive/drive.js';
import { createDriveDatabase } from '../drive/DriveRepository.js';
import { createLlmRouterClient } from '../llmRouter/llmRouter.js';
import { createMcpHubClient } from '../mcpHub/mcpHub.js';
import { createTgUserbotClient } from '../tgUserbot/tgUserbot.js';
import { createWebNavigatorClient } from '../webNavigator/webNavigator.js';
import type { DiskD } from './types.js';

export const diskd: DiskD = {
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

  llm: ({ auth, url }) => createLlmRouterClient({ auth, url }),

  mcpHub: ({ auth, workspaceId, url }) => createMcpHubClient({ auth, workspaceId, url }),

  agentHub: ({ auth, workspaceId, url }) => createAgentHubClient({ auth, workspaceId, url }),

  tgUserbot: ({ auth, workspaceId, url }) => createTgUserbotClient({ auth, workspaceId, url }),

  webNavigator: ({ auth, workspaceId, url }) => createWebNavigatorClient({ auth, workspaceId, url }),
};

