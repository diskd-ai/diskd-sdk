/**
 * Agent Hub validation -- internal auth (API key)
 *
 * Validates Agent Hub SDK methods: agents.list, invoke (streaming)
 *
 * Environment:
 *   DISKD_BASE_URL  - Gateway URL (default: https://apis.diskd.local:8080)
 *   API_KEY         - API key (default: key-dev-1234567890)
 *   WORKSPACE_ID    - Workspace ID (default: dev-user-id)
 *
 * Run:
 *   DISKD_BASE_URL=https://apis.diskd.local:8080 NODE_TLS_REJECT_UNAUTHORIZED=0 \
 *     bun run scripts:build && node dist-scripts/scripts/validate-agents-internal.js
 */

import type { AuthModule } from '../src/auth/types.js';
import { diskd } from '../src/sdk/diskd.js';
import { createHarness } from './_harness.js';

const API_KEY = process.env.API_KEY ?? 'key-dev-1234567890';
const WORKSPACE_ID = process.env.WORKSPACE_ID ?? 'dev-user-id';
const BASE_URL = process.env.DISKD_BASE_URL ?? 'https://apis.diskd.local:8080';
const h = createHarness('Agent Hub (internal)');

console.log('=== Agent Hub validation (internal / API key) ===\n');
console.log(`Gateway: ${BASE_URL}`);
console.log(`Workspace: ${WORKSPACE_ID}\n`);

const bearerAuth: AuthModule = {
  signIn: async () => {},
  signOut: () => {},
  handleRedirectCallback: async () => {},
  getAccessToken: async () => API_KEY,
  getToken: () => ({ accessToken: API_KEY }),
  getRequestHeaders: async () => ({
    Authorization: `Bearer ${API_KEY}`,
    'X-Workspace-Id': WORKSPACE_ID,
    'X-User-Id': WORKSPACE_ID,
  }),
};
h.ok('auth', 'bearer configured');

const agentHubUrl = `${BASE_URL}/os/agents`;
const agentHub = diskd.os.agents({ auth: bearerAuth, workspaceId: WORKSPACE_ID, url: agentHubUrl });

// -- agents.list --
let targetAgentId = '';

try {
  const agents = await agentHub.agents.list();
  const names = agents.map((a) => a.id).join(', ');
  h.ok('agentHub.agents.list', `${agents.length} agents: ${names}`);

  const research = agents.find(
    (a) => a.id.includes('research') || a.displayName.toLowerCase().includes('research'),
  );
  targetAgentId = research?.id ?? agents[0]?.id ?? '';
  if (targetAgentId) {
    h.ok('agentHub.targetAgent', targetAgentId);
  }
} catch (err) {
  h.fail('agentHub.agents.list', err);
}

// -- invoke (streaming) --
if (targetAgentId) {
  try {
    const { StreamProtocolHandler } = await import('../src/agentHub/StreamProtocolHandler.js');

    let responseText = '';
    let tokenInfo = '';
    let failedMsg = '';

    const handler = new StreamProtocolHandler()
      .on('response.output_text.delta', (e: { delta: string }) => {
        responseText += e.delta;
      })
      .on('response.output_text.done', (e: { text: string }) => {
        if (!responseText && e.text) responseText = e.text;
      })
      .on('response.completed', (e: { response: { usage?: { input_tokens: number; output_tokens: number } | null; output?: ReadonlyArray<{ content?: ReadonlyArray<{ text?: string }> }> } }) => {
        if (e.response.usage) {
          tokenInfo = `${e.response.usage.input_tokens}in/${e.response.usage.output_tokens}out`;
        }
        if (!responseText && e.response.output) {
          for (const item of e.response.output) {
            for (const part of item.content ?? []) {
              if (part.text) responseText += part.text;
            }
          }
        }
      })
      .on('response.failed', (e: { response: { error: { message: string } } }) => {
        failedMsg = e.response.error.message;
      })
      .on('error', (e: { message: string }) => {
        failedMsg = e.message;
      });

    const stream = await agentHub.invoke({
      agentName: targetAgentId,
      query: 'What is the capital of Japan? Reply in one sentence.',
      context: { user: { id: WORKSPACE_ID, name: 'validation-script' } },
      agentOptions: { provider: 'upgraide', model: 'small', maxTokens: 1024 },
    });

    await new Promise<void>((resolve, reject) => {
      stream
        .map((event) => handler.handle(event))
        .stop(() => resolve())
        .catch((err) => reject(err));
    });

    if (failedMsg) {
      h.fail('agentHub.invoke', `agent error: ${failedMsg}`);
    } else if (responseText.length > 0) {
      h.ok('agentHub.invoke', `${tokenInfo} "${responseText.slice(0, 100)}"`);
    } else {
      h.fail('agentHub.invoke', 'empty response (no text deltas received)');
    }
  } catch (err) {
    h.fail('agentHub.invoke', err);
  }
}

h.summary();
process.exit(h.exitCode());
