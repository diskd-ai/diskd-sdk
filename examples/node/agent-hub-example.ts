/**
 * Agent Hub SDK -- internal service example
 *
 * Demonstrates agent invocation with StreamProtocolHandler/StreamProtocolStream,
 * supported agents listing, model discovery, and billing aliases.
 *
 * Environment:
 *   AGENT_HUB_URL    - Agent Hub service URL (default: http://localhost:8081)
 *   AGENT_HUB_API_KEY - API key (default: key-dev-1234567890)
 *   WORKSPACE_ID     - Workspace ID (default: dev-user-id)
 *
 * Run:
 *   npm run examples:build && node dist-examples/node/agent-hub-example.js
 */

import { diskd } from '../../src/sdk/diskd.js';
import { StreamProtocolHandler } from '../../src/agentHub/StreamProtocolHandler.js';
import type { TextOutputDeltaEvent, ResponseCompletedEvent, ResponseFailedEvent, StreamProtocolErrorEvent } from '../../src/agentHub/streamProtocolMap.js';

// ---------------------------------------------------------------------------
// Configuration from environment
// ---------------------------------------------------------------------------

const AGENT_HUB_URL = process.env.AGENT_HUB_URL ?? 'http://localhost:8081';
const AGENT_HUB_API_KEY = process.env.AGENT_HUB_API_KEY ?? 'key-dev-1234567890';
const WORKSPACE_ID = process.env.WORKSPACE_ID ?? 'dev-user-id';

// ---------------------------------------------------------------------------
// Create Agent Hub client via diskd factory (internal service pattern)
// ---------------------------------------------------------------------------

const auth = diskd.auth.apiKey({
  apiKey: AGENT_HUB_API_KEY,
  workspaceId: WORKSPACE_ID,
});

const agentHub = diskd.os.agents({ auth, workspaceId: WORKSPACE_ID, url: AGENT_HUB_URL });

console.log(`Connecting to Agent Hub at ${AGENT_HUB_URL}`);
console.log(`Workspace: ${WORKSPACE_ID}\n`);

// ---------------------------------------------------------------------------
// 1. List supported agents
// ---------------------------------------------------------------------------

console.log('=== 1. List supported agents ===');

const agents = await agentHub.agents.list();

console.log(`[ok] Found ${agents.length} agent(s)`);
for (const agent of agents) {
  console.log(`     ${agent.id} -- "${agent.displayName}"`);
}

// ---------------------------------------------------------------------------
// 2. Get supported models for first agent
// ---------------------------------------------------------------------------

const firstAgent = agents[0];

if (firstAgent) {
  console.log(`\n=== 2. Supported models for "${firstAgent.id}" ===`);

  const modelsResult = await agentHub.agents.getSupportedModels(firstAgent.id);

  console.log(`[ok] ${modelsResult.models.length} model(s)`);
  for (const m of modelsResult.models.slice(0, 5)) {
    const types = m.supportedTypes?.join(', ') ?? '';
    console.log(`     ${m.provider}/${m.model} -- "${m.displayName}" [${types}]`);
  }
  if (modelsResult.models.length > 5) {
    console.log(`     ... and ${modelsResult.models.length - 5} more`);
  }
} else {
  console.log('\n=== 2. Supported models ===');
  console.log('[skip] No agents available');
}

// ---------------------------------------------------------------------------
// 3. Get billing aliases
// ---------------------------------------------------------------------------

console.log('\n=== 3. Billing aliases ===');

const billing = await agentHub.billing.getAliases();

console.log(`[ok] ${billing.models.length} model alias(es), ${billing.providers.length} provider(s), ${billing.agents.length} agent(s)`);
for (const alias of billing.models.slice(0, 3)) {
  console.log(`     ${alias.billingAlias} -> ${alias.provider}/${alias.model}`);
}

// ---------------------------------------------------------------------------
// 4. Invoke agent using StreamProtocolHandler (fluent API)
// ---------------------------------------------------------------------------

if (firstAgent) {
  console.log(`\n=== 4. Invoke agent "${firstAgent.id}" (StreamProtocolHandler) ===`);

  let eventCount = 0;

  const handler = new StreamProtocolHandler()
    .on('response.output_text.delta', (event: TextOutputDeltaEvent) => {
      eventCount++;
      process.stdout.write(event.delta);
    })
    .on('response.completed', (_event: ResponseCompletedEvent) => {
      process.stdout.write('\n');
      console.log(`     [completed] Total events: ${eventCount}`);
      if (_event.response.usage) {
        const u = _event.response.usage;
        console.log(`     Tokens: ${u.input_tokens} in, ${u.output_tokens} out, ${u.total_tokens} total`);
      }
    })
    .on('response.failed', (event: ResponseFailedEvent) => {
      console.log(`\n     [failed] ${event.response.error.message}`);
    })
    .on('error', (event: StreamProtocolErrorEvent) => {
      console.log(`\n     [error] ${event.message}`);
    });

  process.stdout.write('[ok] Response: ');

  const stream = await agentHub.invoke({
    agentName: firstAgent.id,
    query: 'Hello, what can you help me with? Reply in one sentence.',
    agentOptions: { maxTokens: 128, temperature: 0.3 },
  });

  await new Promise<void>((resolve, reject) => {
    stream
      .map((event) => handler.handle(event))
      .stop(() => resolve())
      .catch((err) => reject(err));
  });
} else {
  console.log('\n=== 4. Invoke agent ===');
  console.log('[skip] No agents available');
}

console.log('\n[done] All Agent Hub operations completed successfully');
