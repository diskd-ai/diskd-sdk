/** Decode JWT payload without signature verification (claims extraction only). */
export const extractWorkspaceId = (accessToken: string): string => {
  const parts = accessToken.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT: expected 3 parts');
  }
  const payload = parts[1];
  const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
  const decoded = Buffer.from(padded, 'base64url').toString('utf-8');
  const claims: Record<string, unknown> = JSON.parse(decoded);

  // ext.workspace_id (Hydra token hook) > workspace_id (top-level) > sub (client_id = workspace_id)
  const ext =
    typeof claims.ext === 'object' && claims.ext !== null
      ? (claims.ext as Record<string, unknown>)
      : {};
  const workspaceId =
    (typeof ext.workspace_id === 'string' && ext.workspace_id) ||
    (typeof claims.workspace_id === 'string' && claims.workspace_id) ||
    (typeof claims.sub === 'string' && claims.sub);

  if (!workspaceId) {
    throw new Error('JWT has no workspace_id claim');
  }
  return workspaceId;
};
