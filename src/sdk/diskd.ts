import { createDriveClient } from '../drive/drive.js';
import type { DiskD } from './types.js';

export const diskd: DiskD = {
  drive: ({ version, auth, url }) => {
    if (version !== 'v1') {
      throw new Error('Unsupported Drive API version');
    }
    return createDriveClient({ version, auth, url });
  },
};

