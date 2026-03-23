import assert from 'node:assert/strict';
import test from 'node:test';
import { diskd } from '../index.js';
import { checkApiKeyEnv } from '../testing/index.js';

const check = checkApiKeyEnv();
const skipReason = check.tag === 'Skip' ? check.reason : false;

const LLM_ROUTER_URL = process.env.LLM_ROUTER_URL;

const makeLlm = () => {
  if (check.tag !== 'Ready') throw new Error('unreachable');
  const auth = diskd.auth.apiKey({ workspaceId: check.env.workspaceId });
  return diskd.os.llm({ auth, ...(LLM_ROUTER_URL ? { url: LLM_ROUTER_URL } : {}) });
};

// -- Models --

test('integration: llm.models.listAll returns model info array', { skip: skipReason }, async () => {
  const llm = makeLlm();
  const result = await llm.models.listAll();
  assert.ok(Array.isArray(result.models));
});

test('integration: llm.models.list returns models for a specific provider', {
  skip: skipReason,
}, async () => {
  const llm = makeLlm();
  // first get all models to find an available provider
  const all = await llm.models.listAll();
  if (all.models.length === 0) return; // no providers configured

  const provider = all.models[0]?.provider;
  assert.ok(provider, 'should have at least one provider');

  const result = await llm.models.list({ provider });
  assert.ok(Array.isArray(result.models));
});

// -- Completions (non-streaming) --

test('integration: llm.completions.create returns a completion', { skip: skipReason }, async () => {
  const llm = makeLlm();
  const all = await llm.models.listAll();
  if (all.models.length === 0) return; // no providers configured

  const model = all.models[0];
  assert.ok(model);

  const result = await llm.completions.create({
    provider: model.provider,
    model: model.model,
    messages: [{ role: 'user', content: 'Reply with exactly: PONG' }],
    maxTokens: 10,
  });

  assert.ok(result.choices.length > 0);
  assert.ok(result.choices[0]?.message?.content);
  assert.ok(result.usage);
});

// -- Completions (streaming) --

test('integration: llm.completions.stream yields chunks', { skip: skipReason }, async () => {
  const llm = makeLlm();
  const all = await llm.models.listAll();
  if (all.models.length === 0) return;

  const model = all.models[0];
  assert.ok(model);

  const stream = llm.completions.stream({
    provider: model.provider,
    model: model.model,
    messages: [{ role: 'user', content: 'Reply with exactly: STREAM' }],
    maxTokens: 10,
  });

  let chunkCount = 0;
  for await (const chunk of stream) {
    assert.ok(chunk);
    chunkCount++;
  }
  assert.ok(chunkCount > 0, 'should receive at least one chunk');
});

// -- Embeddings --

test('integration: llm.embeddings.create returns vectors', { skip: skipReason }, async () => {
  const llm = makeLlm();
  const all = await llm.models.listAll();
  // find an embedding-capable model
  const embModel = all.models.find((m) => m.supportedFeatures.includes('embedding'));
  if (!embModel) return; // no embedding models configured

  const result = await llm.embeddings.create({
    provider: embModel.provider,
    model: embModel.model,
    input: 'Hello world',
  });

  assert.ok(result.data.length > 0);
  assert.ok(Array.isArray(result.data[0]?.embedding));
  assert.ok(result.usage);
});
