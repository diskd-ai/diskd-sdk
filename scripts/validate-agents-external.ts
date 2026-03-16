/**
 * Agent Hub validation -- external auth (OAuth2 credentials.json)
 *
 * Validates Agent Hub SDK methods: agents.list, invoke (streaming)
 *
 * Environment:
 *   DISKD_BASE_URL         - Gateway URL (default: https://apis.upgraide.dev)
 *   DISKD_CREDENTIALS_PATH - Path to credentials.json (default: ./credentials.json)
 * Run:
 *   bun run scripts:build && NODE_TLS_REJECT_UNAUTHORIZED=0 node dist-scripts/scripts/validate-agents-external.js
 */

import { diskd } from '../src/sdk/diskd.js';
import { createHarness } from './_harness.js';

const CREDENTIALS_PATH = process.env.DISKD_CREDENTIALS_PATH ?? './credentials.json';
const h = createHarness('Agent Hub (external)');

console.log('=== Agent Hub validation (external / OAuth2) ===\n');
console.log(`Credentials: ${CREDENTIALS_PATH}\n`);

const auth = await diskd.auth.credentials({
  scopes: ['openid'],
  keyfilePath: CREDENTIALS_PATH,
});
h.ok('auth.credentials', 'OAuth2 token acquired');

const workspaceId = await auth.getWorkspaceId();
console.log(`Workspace (from token): ${workspaceId}\n`);

const agentHub = diskd.os.agents({ auth });

// -- agents.list --
let targetAgentId = '';

try {
  const agents = await agentHub.agents.list();
  h.ok('agentHub.agents.list', `found ${agents.length} agent(s): ${agents.map((a) => a.id).join(', ')}`);

  const research = agents.find(
    (a) => a.id.includes('research') || a.displayName.toLowerCase().includes('research'),
  );
  if (research) {
    targetAgentId = research.id;
  } else if (agents.length > 0) {
    targetAgentId = agents[0].id;
  }
  if (targetAgentId) {
    h.ok('agentHub.targetAgent', `id=${targetAgentId}`);
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

    const handler = new StreamProtocolHandler()
      .on('response.output_text.delta', (e: { delta: string }) => {
        responseText += e.delta;
      })
      .on('response.completed', (e: { response: { usage?: { input_tokens: number; output_tokens: number } | null } }) => {
        if (e.response.usage) {
          const u = e.response.usage;
          tokenInfo = `${u.input_tokens}in/${u.output_tokens}out`;
        }
      })
      .on('response.failed', (e: { response: { error: { message: string } } }) => {
        throw new Error(e.response.error.message);
      })
      .on('error', (e: { message: string }) => {
        throw new Error(e.message);
      });

    const stream = await agentHub.invoke({
      agentName: targetAgentId,
      query: 'What is the capital of Japan? Reply in one sentence.',
      context: { user: { id: workspaceId, name: 'validation-script' } },
      agentOptions: { provider: 'upgraide', model: 'small', maxTokens: 1024 },
    });

    await new Promise<void>((resolve, reject) => {
      stream
        .map((event) => handler.handle(event))
        .stop(() => resolve())
        .catch((err) => reject(err));
    });

    h.ok('agentHub.invoke', `agent=${targetAgentId}, ${tokenInfo}, reply="${responseText.slice(0, 80)}"`);
  } catch (err) {
    h.fail('agentHub.invoke', err);
  }
}

h.summary();
process.exit(h.exitCode());
