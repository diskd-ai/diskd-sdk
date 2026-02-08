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

export type AuthToken = { readonly accessToken: string };

export type AuthModule = {
  readonly signIn: () => Promise<void>;
  readonly signOut: () => void;
  readonly handleRedirectCallback: () => Promise<void>;
  readonly getAccessToken: () => Promise<string>;
  readonly getToken: () => AuthToken | null;
};

