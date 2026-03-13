/**
 * LLM Router SDK -- internal service example
 *
 * Demonstrates chat completions (non-streaming and streaming), model listing,
 * and embeddings using API key auth (internal service pattern).
 *
 * Environment:
 *   LLM_ROUTER_URL   - LLM Router service URL (default: http://localhost:3000)
 *   LLM_API_KEY      - API key (default: key-dev-1234567890)
 *   WORKSPACE_ID     - Workspace ID (default: dev-user-id)
 *
 * Run:
 *   npm run examples:build && node dist-examples/node/llm-router-example.js
 */

import { diskd } from '../../src/sdk/diskd.js';

// ---------------------------------------------------------------------------
// Configuration from environment
// ---------------------------------------------------------------------------

const LLM_ROUTER_URL = process.env.LLM_ROUTER_URL ?? 'http://localhost:3000';
const LLM_API_KEY = process.env.LLM_API_KEY ?? 'key-dev-1234567890';
const WORKSPACE_ID = process.env.WORKSPACE_ID ?? 'dev-user-id';

// ---------------------------------------------------------------------------
// Create LLM Router client via diskd factory (internal service pattern)
// ---------------------------------------------------------------------------

const auth = diskd.auth.apiKey({
  apiKey: LLM_API_KEY,
  workspaceId: WORKSPACE_ID,
});

const llm = diskd.os.llm({ auth, url: LLM_ROUTER_URL });

console.log(`Connecting to LLM Router at ${LLM_ROUTER_URL}`);
console.log(`Workspace: ${WORKSPACE_ID}\n`);

// ---------------------------------------------------------------------------
// 1. Non-streaming chat completion
// ---------------------------------------------------------------------------

console.log('=== 1. Non-streaming chat completion ===');

const completion = await llm.completions.create({
  provider: 'openai',
  model: 'gpt-4o-mini',
  messages: [
    { role: 'system', content: 'You are a concise assistant. Reply in one sentence.' },
    { role: 'user', content: 'What is the capital of France?' },
  ],
  maxTokens: 64,
  temperature: 0.2,
});

const firstChoice = completion.choices[0];
const replyContent = firstChoice?.message?.content ?? '(no content)';
console.log(`[ok] Completion ID: ${completion.id}`);
console.log(`     Model: ${completion.model}`);
console.log(`     Finish reason: ${firstChoice?.finishReason ?? 'unknown'}`);
console.log(`     Reply: ${replyContent}`);
if (completion.usage) {
  console.log(`     Tokens: ${completion.usage.promptTokens} prompt, ${completion.usage.completionTokens} completion`);
}

// ---------------------------------------------------------------------------
// 2. Streaming chat completion
// ---------------------------------------------------------------------------

console.log('\n=== 2. Streaming chat completion ===');

const streamParams = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  messages: [
    { role: 'user' as const, content: 'Count from 1 to 5, one number per line.' },
  ],
  maxTokens: 64,
  temperature: 0,
};

process.stdout.write('[ok] Stream: ');
let streamedText = '';
let lastChunkId = '';

for await (const chunk of llm.completions.stream(streamParams)) {
  lastChunkId = chunk.id;
  const delta = chunk.choices[0]?.delta?.content;
  if (delta) {
    process.stdout.write(delta);
    streamedText += delta;
  }
}

process.stdout.write('\n');
console.log(`     Chunk ID: ${lastChunkId}`);
console.log(`     Total streamed chars: ${streamedText.length}`);

// ---------------------------------------------------------------------------
// 3. List all models across providers
// ---------------------------------------------------------------------------

console.log('\n=== 3. List all models ===');

const modelsResult = await llm.models.listAll();
console.log(`[ok] Found ${modelsResult.models.length} model(s) across all providers`);

// Print up to 5 models as a sample
const sample = modelsResult.models.slice(0, 5);
for (const m of sample) {
  const features = m.supportedFeatures.length > 0 ? ` [${m.supportedFeatures.join(', ')}]` : '';
  console.log(`     ${m.provider}/${m.model} -- ${m.displayName}${features}`);
}
if (modelsResult.models.length > 5) {
  console.log(`     ... and ${modelsResult.models.length - 5} more`);
}

// List models for a specific provider
const providerResult = await llm.models.list({ provider: 'openai' });
console.log(`\n[ok] OpenAI provider has ${providerResult.models.length} model(s)`);

// ---------------------------------------------------------------------------
// 4. Create embeddings
// ---------------------------------------------------------------------------

console.log('\n=== 4. Create embeddings ===');

const embeddingResult = await llm.embeddings.create({
  provider: 'openai',
  model: 'text-embedding-3-small',
  input: [
    'The quick brown fox jumps over the lazy dog.',
    'Pack my box with five dozen liquor jugs.',
  ],
  dimensions: 256,
});

console.log(`[ok] Embedding model: ${embeddingResult.model}`);
console.log(`     Vectors: ${embeddingResult.data.length}`);
for (const item of embeddingResult.data) {
  const norm = Math.sqrt(item.embedding.reduce((s, v) => s + v * v, 0));
  console.log(`     [${item.index}] dimensions=${item.embedding.length}, L2-norm=${norm.toFixed(4)}`);
}
console.log(`     Tokens used: ${embeddingResult.usage.totalTokens}`);

console.log('\n[done] All LLM Router operations completed successfully');
