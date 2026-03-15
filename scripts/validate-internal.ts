/**
 * apis-service validation -- internal auth (API key)
 *
 * Validates SDK namespaces through the apis gateway using API key headers.
 *
 * Environment:
 *   DISKD_BASE_URL  - Gateway URL (default: https://apis.diskd.local:8080)
 *   API_KEY         - API key (default: key-dev-1234567890)
 *   WORKSPACE_ID    - Workspace ID (default: dev-user-id)
 *
 * Run:
 *   DISKD_BASE_URL=https://apis.diskd.local:8080 NODE_TLS_REJECT_UNAUTHORIZED=0 \
 *     bun run scripts:build && node dist-scripts/scripts/validate-internal.js
 */

import type { AuthModule } from '../src/auth/types.js';
import { diskd } from '../src/sdk/diskd.js';

const API_KEY = process.env.API_KEY ?? 'key-dev-1234567890';
const WORKSPACE_ID = process.env.WORKSPACE_ID ?? 'dev-user-id';
const BASE_URL = process.env.DISKD_BASE_URL ?? 'https://apis.diskd.local:8080';

let passed = 0;
let failed = 0;

const ok = (name: string, detail?: string) => {
  passed++;
  console.log(`  [PASS] ${name}${detail ? ` -- ${detail}` : ''}`);
};

const fail = (name: string, err: unknown) => {
  failed++;
  console.log(`  [FAIL] ${name} -- ${String(err)}`);
};

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

console.log('=== apis-service validation (internal / API key) ===\n');
console.log(`Gateway: ${BASE_URL}`);
console.log(`Workspace: ${WORKSPACE_ID}\n`);

// api_key auth for Drive (X-Api-Key headers)
const driveAuth = diskd.auth.apiKey({ apiKey: API_KEY, workspaceId: WORKSPACE_ID });

// bearer auth for LLM Router and Agent Hub (Authorization: Bearer + identity headers)
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

ok('auth', 'api_key + bearer configured');

// ---------------------------------------------------------------------------
// 1. Drive: mkdir, upload, list by path, read, update, rename, delete
// ---------------------------------------------------------------------------

console.log('\n--- Drive (os/drive) ---');

const driveUrl = `${BASE_URL}/os/drive/api/v1`;
const drive = diskd.os.drive({ version: 'v1', auth: driveAuth, url: driveUrl });

try {
  await drive.init();
  ok('drive.init');
} catch (err) {
  fail('drive.init', err);
}

// Create test directory
let testDirInode = '';
try {
  const result = await drive.create({ dirName: 'sdk-validation-test' });
  testDirInode = result.inode;
  ok('drive.create', 'mkdir /sdk-validation-test');
} catch (err) {
  // May already exist -- list and resolve
  try {
    const entries = await drive.list({ path: '/' });
    const existing = entries.find((e) => e.name === 'sdk-validation-test');
    if (existing) {
      testDirInode = existing.inode;
      ok('drive.create', '/sdk-validation-test already exists');
    } else {
      fail('drive.create', err);
    }
  } catch (listErr) {
    fail('drive.create', err);
  }
}

// List root by path
try {
  const entries = await drive.list({ path: '/' });
  const names = entries.map((e) => e.name).join(', ');
  ok('drive.list (/)', `${entries.length} entries: ${names}`);
} catch (err) {
  fail('drive.list (/)', err);
}

// Upload file into test dir
const testContent = `hello from validation ${Date.now()}`;
const testBytes = new TextEncoder().encode(testContent);
let testFileInode = '';

if (testDirInode) {
  try {
    const result = await drive.upload.file({
      name: 'hello.txt',
      data: testBytes,
      mimeType: 'text/plain',
      parentInode: testDirInode,
    });
    testFileInode = result.inode;
    ok('drive.upload', '/sdk-validation-test/hello.txt written');
  } catch (err) {
    fail('drive.upload', err);
  }
}

// List subdirectory by path
if (testDirInode) {
  try {
    const entries = await drive.list({ path: '/sdk-validation-test' });
    const names = entries.map((e) => e.name).join(', ');
    ok('drive.list (subdir)', `${entries.length} files: ${names}`);
  } catch (err) {
    fail('drive.list (subdir)', err);
  }
}

// Update file (overwrite)
if (testFileInode && testDirInode) {
  const updatedContent = `${testContent}\nupdated at ${Date.now()}`;
  try {
    const result = await drive.upload.file({
      name: 'hello.txt',
      data: new TextEncoder().encode(updatedContent),
      mimeType: 'text/plain',
      parentInode: testDirInode,
      force: true,
    });
    testFileInode = result.inode;
    ok('drive.update', '/sdk-validation-test/hello.txt overwritten');
  } catch (err) {
    fail('drive.update', err);
  }
}

// Rename file
if (testFileInode) {
  try {
    const newName = `renamed-${Date.now()}.txt`;
    await drive.rename({ inode: testFileInode, newName });
    ok('drive.rename', `/sdk-validation-test/hello.txt -> ${newName}`);
  } catch (err) {
    fail('drive.rename', err);
  }
}

// Delete test directory recursively
if (testDirInode) {
  try {
    await drive.delete({ inodes: [testDirInode], recursive: true });
    ok('drive.delete', '/sdk-validation-test deleted recursively');
  } catch (err) {
    fail('drive.delete', err);
  }

  // Verify
  try {
    const entries = await drive.list({ path: '/' });
    const still = entries.find((e) => e.name === 'sdk-validation-test');
    if (!still) {
      ok('drive.verify', 'directory gone');
    } else {
      fail('drive.verify', 'directory still present');
    }
  } catch (err) {
    fail('drive.verify', err);
  }
}

// ---------------------------------------------------------------------------
// 2. LLM: models, completion, streaming
// ---------------------------------------------------------------------------

console.log('\n--- LLM Router (os/llm) ---');

const llmUrl = `${BASE_URL}/os/llm`;
const llm = diskd.os.llm({ auth: bearerAuth, url: llmUrl });

try {
  const models = await llm.models.listAll();
  const sample = models.models.slice(0, 3).map((m) => `${m.provider}/${m.model}`);
  ok('llm.models.listAll', `${models.models.length} models (${sample.join(', ')}...)`);
} catch (err) {
  fail('llm.models.listAll', err);
}

try {
  const completion = await llm.completions.create({
    provider: 'upgraide',
    model: 'small',
    messages: [{ role: 'user', content: 'Hello, who are you?' }],
    maxTokens: 128,
  });
  const reply = completion.choices[0]?.message?.content ?? '';
  if (reply.length > 0) {
    ok('llm.completions.create', `"${reply.slice(0, 100)}"`);
  } else {
    fail('llm.completions.create', 'empty reply');
  }
} catch (err) {
  fail('llm.completions.create', err);
}

try {
  let streamedText = '';
  for await (const chunk of llm.completions.stream({
    provider: 'upgraide',
    model: 'small',
    messages: [{ role: 'user', content: 'Count from 1 to 5.' }],
    maxTokens: 64,
  })) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) streamedText += delta;
  }
  if (streamedText.length > 0) {
    ok('llm.completions.stream', `"${streamedText.trim()}"`);
  } else {
    fail('llm.completions.stream', 'empty stream (0 chars)');
  }
} catch (err) {
  fail('llm.completions.stream', err);
}

// ---------------------------------------------------------------------------
// 3. Agent Hub: list agents, invoke research agent
// ---------------------------------------------------------------------------

console.log('\n--- Agent Hub (os/agents) ---');

const agentHubUrl = `${BASE_URL}/os/agents`;
const agentHub = diskd.os.agents({ auth: bearerAuth, workspaceId: WORKSPACE_ID, url: agentHubUrl });

let targetAgentId = '';

try {
  const agents = await agentHub.agents.list();
  const names = agents.map((a) => a.id).join(', ');
  ok('agentHub.agents.list', `${agents.length} agents: ${names}`);

  const research = agents.find(
    (a) => a.id.includes('research') || a.displayName.toLowerCase().includes('research')
  );
  targetAgentId = research?.id ?? agents[0]?.id ?? '';
  if (targetAgentId) {
    ok('agentHub.targetAgent', targetAgentId);
  }
} catch (err) {
  fail('agentHub.agents.list', err);
}

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
      fail('agentHub.invoke', `agent error: ${failedMsg}`);
    } else if (responseText.length > 0) {
      ok('agentHub.invoke', `${tokenInfo} "${responseText.slice(0, 100)}"`);
    } else {
      fail('agentHub.invoke', 'empty response (no text deltas received)');
    }
  } catch (err) {
    fail('agentHub.invoke', err);
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
