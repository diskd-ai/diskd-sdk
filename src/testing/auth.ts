import type { AuthModule } from '../auth/types.js';

export type MakeAuthOptions = {
  readonly accessToken?: string;
  readonly workspaceId?: string;
};

/** Create a stub AuthModule for testing. Framework-agnostic, no side effects. */
export const makeAuth = (options?: MakeAuthOptions): AuthModule => {
  const token = options?.accessToken ?? 'token-123';
  const wsId = options?.workspaceId ?? 'test-workspace';
  return {
    signIn: async () => {},
    signOut: () => {},
    handleRedirectCallback: async () => {},
    getAccessToken: async () => token,
    getToken: () => ({ accessToken: token }),
    getWorkspaceId: async () => wsId,
  };
};
