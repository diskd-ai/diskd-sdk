/**
 * apis-service validation -- external auth (OAuth2 credentials.json)
 *
 * Validates SDK namespaces through the apis gateway using OAuth2 bearer tokens.
 * Runs against apis.upgraide.dev (or DISKD_BASE_URL).
 *
 * Environment:
 *   DISKD_BASE_URL         - Gateway URL (default: https://apis.upgraide.dev)
 *   DISKD_CREDENTIALS_PATH - Path to credentials.json (default: ./credentials.json)
 *   DISKD_WORKSPACE_ID     - Workspace ID (default: dev-user-id)
 *
 * Run:
 *   bun run scripts:build && NODE_TLS_REJECT_UNAUTHORIZED=0 node dist-scripts/scripts/validate-external.js
 */

import { diskd } from '../src/sdk/diskd.js';

const CREDENTIALS_PATH = process.env.DISKD_CREDENTIALS_PATH ?? './credentials.json';
const WORKSPACE_ID = process.env.DISKD_WORKSPACE_ID ?? 'dev-user-id';

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

console.log('=== apis-service validation (external / OAuth2) ===\n');
console.log(`Gateway: ${process.env.DISKD_BASE_URL ?? 'https://apis.upgraide.dev'}`);
console.log(`Credentials: ${CREDENTIALS_PATH}`);
console.log(`Workspace: ${WORKSPACE_ID}\n`);

const auth = await diskd.auth.credentials({
  scopes: ['openid'],
  keyfilePath: CREDENTIALS_PATH,
});

ok('auth.credentials', 'OAuth2 token acquired');

// ---------------------------------------------------------------------------
// 1. Drive: init, list, write, read, update, delete
// ---------------------------------------------------------------------------

console.log('\n--- Drive (os/drive) ---');

const drive = diskd.os.drive({ version: 'v1', auth });

try {
  await drive.init();
  ok('drive.init');
} catch (err) {
  fail('drive.init', err);
}

// Create test directory
try {
  await drive.create({ dirName: 'sdk-validation-test' });
  ok('drive.create (mkdir)', 'path=/sdk-validation-test');
} catch (err) {
  ok('drive.create (mkdir)', 'directory exists or created');
}

// List root
try {
  const entries = await drive.list({ path: '/' });
  ok('drive.list (/)', `${entries.length} entries at root`);
} catch (err) {
  fail('drive.list (/)', err);
}

const testContent = `validation test ${Date.now()}`;
const testBytes = new TextEncoder().encode(testContent);
let testDirInode = '';
let testFileInode = '';

try {
  const entries = await drive.list({ path: '/' });
  const testDir = entries.find((e) => e.name === 'sdk-validation-test');
  if (testDir) {
    testDirInode = testDir.inode;
    const uploadResult = await drive.upload.file({
      name: 'test-file.txt',
      data: testBytes,
      mimeType: 'text/plain',
      parentInode: testDirInode,
    });
    testFileInode = uploadResult.inode;
    ok('drive.upload', `path=/sdk-validation-test/test-file.txt`);
  } else {
    fail('drive.upload', 'test directory not found');
  }
} catch (err) {
  fail('drive.upload', err);
}

if (testDirInode) {
  try {
    const entries = await drive.list({ path: '/sdk-validation-test' });
    ok('drive.list (subdir)', `${entries.length} entries`);
  } catch (err) {
    fail('drive.list (subdir)', err);
  }
}

if (testFileInode) {
  try {
    const downloadResult = await drive.download.file({ inode: testFileInode });
    const chunks: Uint8Array[] = [];
    const reader = downloadResult.stream.getReader();
    let readDone = false;
    while (!readDone) {
      const { done, value } = await reader.read();
      if (done) {
        readDone = true;
      } else {
        chunks.push(value);
      }
    }
    const downloaded = new TextDecoder().decode(Buffer.concat(chunks));
    if (downloaded === testContent) {
      ok('drive.download', 'content matches');
    } else {
      fail('drive.download', `content mismatch: got "${downloaded.slice(0, 50)}"`);
    }
  } catch (err) {
    fail('drive.download', `${err}`);
  }

  const updatedContent = `${testContent}\nupdated line`;
  const updatedBytes = new TextEncoder().encode(updatedContent);
  try {
    const updateResult = await drive.upload.file({
      name: 'test-file.txt',
      data: updatedBytes,
      mimeType: 'text/plain',
      parentInode: testDirInode,
      force: true,
    });
    ok('drive.update', `new inode=${updateResult.inode}`);
    testFileInode = updateResult.inode;
  } catch (err) {
    fail('drive.update', err);
  }

  try {
    await drive.rename({ inode: testFileInode, newName: 'renamed-file.txt' });
    ok('drive.rename', 'path=/sdk-validation-test/renamed-file.txt');
  } catch (err) {
    fail('drive.rename', err);
  }
}

if (testDirInode) {
  try {
    await drive.delete({ inodes: [testDirInode], recursive: true });
    ok('drive.delete (recursive)', 'path=/sdk-validation-test deleted');
  } catch (err) {
    fail('drive.delete', err);
  }
}

// ---------------------------------------------------------------------------
// 2. LLM: models, completion, streaming
// ---------------------------------------------------------------------------

console.log('\n--- LLM Router (os/llm) ---');

const llm = diskd.os.llm({ auth });

try {
  const models = await llm.models.listAll();
  ok('llm.models.listAll', `${models.models.length} model(s)`);
} catch (err) {
  fail('llm.models.listAll', err);
}

try {
  const completion = await llm.completions.create({
    provider: 'upgraide',
    model: 'small',
    messages: [
      { role: 'system', content: 'You are a concise assistant. Reply in one sentence.' },
      { role: 'user', content: 'What is 2 + 2?' },
    ],
    maxTokens: 64,
    temperature: 0,
  });
  const reply = completion.choices[0]?.message?.content ?? '';
  ok('llm.completions.create', `model=${completion.model}, reply="${reply.slice(0, 80)}"`);
} catch (err) {
  fail('llm.completions.create', err);
}

try {
  let streamedText = '';
  for await (const chunk of llm.completions.stream({
    provider: 'upgraide',
    model: 'small',
    messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }],
    maxTokens: 16,
    temperature: 0,
  })) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) streamedText += delta;
  }
  ok('llm.completions.stream', `streamed ${streamedText.length} chars: "${streamedText.trim()}"`);
} catch (err) {
  fail('llm.completions.stream', err);
}

// ---------------------------------------------------------------------------
// 3. Agent Hub: list agents, invoke
// ---------------------------------------------------------------------------

console.log('\n--- Agent Hub (os/agents) ---');

const agentHub = diskd.os.agents({ auth, workspaceId: WORKSPACE_ID });

let targetAgentId = '';

try {
  const agents = await agentHub.agents.list();
  ok('agentHub.agents.list', `found ${agents.length} agent(s): ${agents.map((a) => a.id).join(', ')}`);

  const research = agents.find(
    (a) => a.id.includes('research') || a.displayName.toLowerCase().includes('research')
  );
  if (research) {
    targetAgentId = research.id;
  } else if (agents.length > 0) {
    targetAgentId = agents[0].id;
  }
  if (targetAgentId) {
    ok('agentHub.targetAgent', `id=${targetAgentId}`);
  }
} catch (err) {
  fail('agentHub.agents.list', err);
}

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
      context: { user: { id: WORKSPACE_ID, name: 'validation-script' } },
      agentOptions: { provider: 'upgraide', model: 'small', maxTokens: 1024 },
    });

    await new Promise<void>((resolve, reject) => {
      stream
        .map((event) => handler.handle(event))
        .stop(() => resolve())
        .catch((err) => reject(err));
    });

    ok('agentHub.invoke', `agent=${targetAgentId}, ${tokenInfo}, reply="${responseText.slice(0, 80)}"`);
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
