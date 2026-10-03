import { resolveDiskdGatewayUrl } from '../env/baseUrl.js';
import * as decode from './emailDecode.js';
import type { EmailClient, EmailClientParams } from './emailTypes.js';

/** Use the public authenticated email gateway; installed MCP servers never participate in provider execution. */
export function createEmailClient(params: EmailClientParams): EmailClient {
  const url = (params.url ?? resolveDiskdGatewayUrl('os/email')).replace(/\/$/, '');
  /** Derive tenant scope from auth and bound every HTTP attempt. */
  const request = async (
    path: string,
    method = 'GET',
    body?: unknown,
    key?: string
  ): Promise<unknown> => {
    const credentials = params.auth.getRequestHeaders
      ? await params.auth.getRequestHeaders()
      : { Authorization: `Bearer ${await params.auth.getAccessToken()}` };
    const workspace = await params.auth.getWorkspaceId();
    const headers = new Headers(credentials);
    headers.set('x-workspace-id', workspace);
    if (body !== undefined) headers.set('content-type', 'application/json');
    if (key) headers.set('idempotency-key', key);
    const response = await fetch(`${url}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`EmailWorkerHttp${response.status}`);
    return response.status === 204 ? undefined : response.json();
  };
  /** Commit once, then wait for the same durable result through worker restarts or delayed execution. */
  const execute = async (command: unknown): Promise<unknown> => {
    const accepted = decode.object(
      await request('/commands', 'POST', command, crypto.randomUUID())
    );
    const jobId = decode.text(accepted.jobId);
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      const result = decode.object(await request(`/jobs/${encodeURIComponent(jobId)}`));
      if (result.status === 'succeeded') return result.result;
      if (result.status === 'failed' || result.status === 'cancelled')
        throw new Error(`EmailCommand ${jobId} ${result.status}`);
      if (result.status !== 'pending') throw new Error('InvalidEmailJobStatus');
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`EmailCommand ${jobId} remains pending after the client deadline`);
  };
  return {
    listAccounts: async () => decode.accounts(await request('/accounts')),
    sync: async (input) =>
      decode.admission(await request('/sync', 'POST', input, crypto.randomUUID())),
    stopSync: async ({ account }) => {
      await request(`/sync/${encodeURIComponent(account)}`, 'DELETE');
    },
    syncStatus: async ({ account }) =>
      decode.syncStatus(await request(`/status/${encodeURIComponent(account)}`)),
    hydrateBodies: async (input) =>
      decode.bodies(await execute({ operation: 'hydrate_bodies', ...input })),
    hydrateAttachment: async (input) =>
      decode.attachment(await execute({ operation: 'hydrate_attachment', ...input })),
    setAttributes: async (input) =>
      decode.attributes(await execute({ operation: 'set_attributes', ...input })),
    deleteMessages: async (input) =>
      decode.deletion(await execute({ operation: 'delete', ...input })),
    testConnection: async (input) =>
      decode.connection(await execute({ operation: 'test_connection', ...input })),
  };
}
