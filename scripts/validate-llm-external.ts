/**
 * LLM Router validation -- external auth (OAuth2 credentials.json)
 *
 * Validates LLM SDK methods: models.listAll, completions.create, completions.stream
 *
 * Environment:
 *   APIS_BASE_URL         - Gateway URL (default: https://apis.upgraide.dev)
 *   DISKD_CREDENTIALS_PATH - Path to credentials.json (default: ./credentials.json)
 *
 * Run:
 *   bun run scripts:build && NODE_TLS_REJECT_UNAUTHORIZED=0 node dist-scripts/scripts/validate-llm-external.js
 */

import { diskd } from '../src/sdk/diskd.js';
import { createHarness } from './_harness.js';

const CREDENTIALS_PATH = process.env.DISKD_CREDENTIALS_PATH ?? './credentials.json';
const h = createHarness('LLM Router (external)');

console.log('=== LLM Router validation (external / OAuth2) ===\n');
console.log(`Gateway: ${process.env.APIS_BASE_URL ?? 'https://apis.upgraide.dev'}`);
console.log(`Credentials: ${CREDENTIALS_PATH}\n`);

const auth = await diskd.auth.credentials({
  scopes: ['openid'],
  keyfilePath: CREDENTIALS_PATH,
});
h.ok('auth.credentials', 'OAuth2 token acquired');

const llm = diskd.os.llm({ auth });

// -- models.listAll --
try {
  const models = await llm.models.listAll();
  if (models.models.length > 0) {
    h.ok('llm.models.listAll', `${models.models.length} model(s)`);
  } else {
    h.fail('llm.models.listAll', 'empty model list');
  }
} catch (err) {
  h.fail('llm.models.listAll', err);
}

// -- completions.create --
try {
  const completion = await llm.completions.create({
    provider: 'upgraide',
    model: 'small',
    messages: [
      { role: 'system', content: 'You are a concise assistant. Reply in one sentence.' },
      { role: 'user', content: 'What is 2 + 2?' },
    ],
    maxTokens: 1024,
    temperature: 0,
  });
  const reply = completion.choices[0]?.message?.content ?? '';
  if (reply.length > 0) {
    h.ok('llm.completions.create', `model=${completion.model}, reply="${reply.slice(0, 80)}"`);
  } else {
    h.fail('llm.completions.create', 'empty response content');
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
    messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }],
    maxTokens: 1024,
    temperature: 0,
  })) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) streamedText += delta;
  }
  if (streamedText.trim().length > 0) {
    h.ok('llm.completions.stream', `streamed: "${streamedText.trim().slice(0, 80)}"`);
  } else {
    h.fail('llm.completions.stream', 'empty stream (0 chars)');
  }
} catch (err) {
  h.fail('llm.completions.stream', err);
}

h.summary();
process.exit(h.exitCode());
