/**
 * Agent Hub validation -- internal auth (API key)
 *
 * Validates Agent Hub SDK methods: agents.list, invoke (streaming)
 *
 * Environment:
 *   APIS_BASE_URL  - Gateway URL (default: https://apis.diskd.local:8080)
 *   APIS_API_KEY    - Gateway API key (default: key-dev-1234567890)
 *   WORKSPACE_ID    - Workspace ID (default: dev-user-id)
 *
 * Run:
 *   APIS_BASE_URL=https://apis.diskd.local:8080 NODE_TLS_REJECT_UNAUTHORIZED=0 \
 *     bun run scripts:build && node dist-scripts/scripts/validate-agents-internal.js
 */

import { diskd } from '../src/sdk/diskd.js';
import { createHarness } from './_harness.js';

const APIS_API_KEY = process.env.APIS_API_KEY ?? 'key-dev-1234567890';
const WORKSPACE_ID = process.env.WORKSPACE_ID ?? 'dev-user-id';
const BASE_URL = process.env.APIS_BASE_URL ?? 'https://apis.diskd.local:8080';
process.env.APIS_API_KEY = APIS_API_KEY;
process.env.APIS_BASE_URL = BASE_URL;
const h = createHarness('Agent Hub (internal)');

console.log('=== Agent Hub validation (internal / API key) ===\n');
console.log(`Gateway: ${BASE_URL}`);
console.log(`Workspace: ${WORKSPACE_ID}\n`);

const apiKeyAuth = diskd.auth.apiKey({ workspaceId: WORKSPACE_ID });
h.ok('auth', 'api_key configured');

const agentHub = diskd.os.agents({ auth: apiKeyAuth });

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
