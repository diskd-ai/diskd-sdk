import type { AuthModule } from '../auth/types.js';
import type { DriveClient } from '../drive/types.js';

export type DiskD = {
  readonly drive: (params: {
    readonly version: 'v1';
    readonly auth: AuthModule;
    readonly url?: string;
  }) => DriveClient;
};

