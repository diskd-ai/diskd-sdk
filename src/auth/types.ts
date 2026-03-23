export type SdkCreateParams =
  | {
      readonly issuer: string;
      readonly clientId: string;
      readonly redirectUri: string;
      readonly scopes: readonly string[];
      readonly audience: string;
    }
  | {
      readonly scopes: readonly string[];
      readonly keyfilePath: string;
    };

export type ApiKeyAuthParams = {
  readonly workspaceId: string;
  readonly orgId?: string;
  readonly userId?: string;
};

export type AuthToken = { readonly accessToken: string };

export type AuthModule = {
  readonly signIn: () => Promise<void>;
  readonly signOut: () => void;
  readonly handleRedirectCallback: () => Promise<void>;
  readonly getAccessToken: () => Promise<string>;
  readonly getToken: () => AuthToken | null;
  /** Returns the workspace ID from the auth context.
   *  OAuth: decoded from the JWT `ext.workspace_id` or `sub` claim.
   *  API key: from the `workspaceId` constructor param. */
  readonly getWorkspaceId: () => Promise<string>;
  /** Returns all auth-related headers for RPC calls.
   *  OAuth: { Authorization: 'Bearer ...' }
   *  API key: { 'X-Api-Key': APIS_API_KEY, 'X-Workspace-Id': '...', ... }
   *  When absent, falls back to Bearer token from getAccessToken(). */
  readonly getRequestHeaders?: () => Promise<Readonly<Record<string, string>>>;
};
