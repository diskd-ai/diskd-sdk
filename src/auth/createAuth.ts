import { extractWorkspaceId } from './jwtClaims.js';
import { readKeyfileFromPath } from './keyfile.js';
import { fetchOidcDiscovery } from './oidcDiscovery.js';
import { createPkceChallenge, createPkceState, createPkceVerifier } from './pkce.js';
import { getSessionStorage } from './sessionStorage.js';
import { requestAuthorizationCodeToken, requestClientCredentialsToken } from './tokenRequests.js';
import type { AuthModule, AuthToken, SdkCreateParams } from './types.js';
import { getLocation, replaceUrlWithoutSearchParams } from './urlRuntime.js';

const hasKeyfilePath = (
  params: SdkCreateParams
): params is Extract<SdkCreateParams, { keyfilePath: string }> => 'keyfilePath' in params;

const storageKeys = {
  verifier: 'diskd_pkce_verifier',
  state: 'diskd_pkce_state',
} as const;

export const createAuth = async (params: SdkCreateParams): Promise<AuthModule> => {
  let token: AuthToken | null = null;
  let discovery: {
    readonly authorization_endpoint: string;
    readonly token_endpoint: string;
  } | null = null;

  const ensureDiscovery = async (issuer: string) => {
    if (discovery) return discovery;
    const loaded = await fetchOidcDiscovery(issuer);
    discovery = {
      authorization_endpoint: loaded.authorization_endpoint,
      token_endpoint: loaded.token_endpoint,
    };
    return discovery;
  };

  const signOut = () => {
    token = null;
  };

  if (hasKeyfilePath(params)) {
    const keyfile = await readKeyfileFromPath(params.keyfilePath);

    // Set APIS_BASE_URL from credentials if not already set
    if (keyfile.apisUrl && !process.env.APIS_BASE_URL) {
      process.env.APIS_BASE_URL = keyfile.apisUrl;
    }

    const getAccessToken = async (): Promise<string> => {
      if (token) return token.accessToken;
      const disc = await ensureDiscovery(keyfile.issuer);
      const accessToken = await requestClientCredentialsToken({
        tokenEndpoint: disc.token_endpoint,
        clientId: keyfile.clientId,
        clientSecret: keyfile.clientSecret,
        audience: keyfile.audience,
        scopes: params.scopes,
      });
      token = { accessToken };
      return accessToken;
    };

    return {
      signIn: async () => {
        await getAccessToken();
      },
      signOut,
      handleRedirectCallback: async () => {},
      getAccessToken,
      getToken: () => token,
      getWorkspaceId: async () => extractWorkspaceId(await getAccessToken()),
    };
  }

  const pkce = params;

  const signIn = async (): Promise<void> => {
    const disc = await ensureDiscovery(pkce.issuer);
    const verifier = createPkceVerifier();
    const challenge = await createPkceChallenge(verifier);
    const state = createPkceState();

    const storage = getSessionStorage();
    storage.setItem(storageKeys.verifier, verifier);
    storage.setItem(storageKeys.state, state);

    const qs = new URLSearchParams({
      client_id: pkce.clientId,
      response_type: 'code',
      scope: pkce.scopes.join(' '),
      audience: pkce.audience,
      redirect_uri: pkce.redirectUri,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    });

    const locationObj = getLocation();
    locationObj.href = `${disc.authorization_endpoint}?${qs.toString()}`;
  };

  const handleRedirectCallback = async (): Promise<void> => {
    const locationObj = getLocation();
    const current = new URL(locationObj.href);
    const code = current.searchParams.get('code');
    const state = current.searchParams.get('state');
    const error = current.searchParams.get('error');

    if (error) {
      replaceUrlWithoutSearchParams();
      throw new Error(error);
    }

    if (!code || !state) return;

    const disc = await ensureDiscovery(pkce.issuer);
    const storage = getSessionStorage();
    const expectedState = storage.getItem(storageKeys.state) ?? '';
    const verifier = storage.getItem(storageKeys.verifier) ?? '';

    if (!verifier || !expectedState || state !== expectedState) {
      throw new Error('Invalid PKCE state');
    }

    storage.removeItem(storageKeys.state);
    storage.removeItem(storageKeys.verifier);

    const accessToken = await requestAuthorizationCodeToken({
      tokenEndpoint: disc.token_endpoint,
      clientId: pkce.clientId,
      redirectUri: pkce.redirectUri,
      code,
      verifier,
    });
    token = { accessToken };
    replaceUrlWithoutSearchParams();
  };

  const getAccessToken = async (): Promise<string> => {
    if (!token) {
      throw new Error(
        'No access token available. Call signIn() and handleRedirectCallback() first.'
      );
    }
    return token.accessToken;
  };

  return {
    signIn,
    signOut,
    handleRedirectCallback,
    getAccessToken,
    getToken: () => token,
    getWorkspaceId: async () => extractWorkspaceId(await getAccessToken()),
  };
};
