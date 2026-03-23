/**
 * LLM Router validation -- internal auth (API key)
 *
 * Validates LLM SDK methods: models.listAll, completions.create, completions.stream
 *
 * Environment:
 *   APIS_BASE_URL  - Gateway URL (default: https://apis.diskd.local:8080)
 *   APIS_API_KEY    - Gateway API key (default: key-dev-1234567890)
 *   WORKSPACE_ID    - Workspace ID (default: dev-user-id)
 *
 * Run:
 *   APIS_BASE_URL=https://apis.diskd.local:8080 NODE_TLS_REJECT_UNAUTHORIZED=0 \
 *     bun run scripts:build && node dist-scripts/scripts/validate-llm-internal.js
 */

import { diskd } from '../src/sdk/diskd.js';
import { createHarness } from './_harness.js';

const APIS_API_KEY = process.env.APIS_API_KEY ?? 'key-dev-1234567890';
const WORKSPACE_ID = process.env.WORKSPACE_ID ?? 'dev-user-id';
const BASE_URL = process.env.APIS_BASE_URL ?? 'https://apis.diskd.local:8080';
process.env.APIS_API_KEY = APIS_API_KEY;
process.env.APIS_BASE_URL = BASE_URL;
const h = createHarness('LLM Router (internal)');

console.log('=== LLM Router validation (internal / API key) ===\n');
console.log(`Gateway: ${BASE_URL}`);
console.log(`Workspace: ${WORKSPACE_ID}\n`);

const apiKeyAuth = diskd.auth.apiKey({ workspaceId: WORKSPACE_ID });
h.ok('auth', 'api_key configured');

const llm = diskd.os.llm({ auth: apiKeyAuth });

// -- models.listAll --
try {
  const models = await llm.models.listAll();
  const sample = models.models.slice(0, 3).map((m) => `${m.provider}/${m.model}`);
  h.ok('llm.models.listAll', `${models.models.length} models (${sample.join(', ')}...)`);
} catch (err) {
  h.fail('llm.models.listAll', err);
}

// -- completions.create --
try {
  const completion = await llm.completions.create({
    provider: 'upgraide',
    model: 'small',
    messages: [{ role: 'user', content: 'Hello, who are you?' }],
    maxTokens: 1024,
  });
  const reply = completion.choices[0]?.message?.content ?? '';
  if (reply.length > 0) {
    h.ok('llm.completions.create', `"${reply.slice(0, 100)}"`);
  } else {
    h.fail('llm.completions.create', 'empty reply');
  }
} catch (err) {
  h.fail('llm.completions.create', err);
}

// -- completions.stream --
try {
  let streamedText = '';
  for await (const chunk of llm.completions.stream({
    provider: 'upgraide',
    model: 'small',
    messages: [{ role: 'user', content: 'Count from 1 to 5.' }],
    maxTokens: 1024,
  })) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) streamedText += delta;
  }
  if (streamedText.length > 0) {
    h.ok('llm.completions.stream', `"${streamedText.trim()}"`);
  } else {
    h.fail('llm.completions.stream', 'empty stream (0 chars)');
  }
} catch (err) {
  h.fail('llm.completions.stream', err);
}

h.summary();
process.exit(h.exitCode());
