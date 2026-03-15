/**
 * apis-service validation -- internal auth (API key)
 *
 * Validates all SDK namespaces through the apis gateway using API key headers.
 * Runs inside Tilt cluster (or via kubectl port-forward to apis-service:3000).
 *
 * Environment:
 *   DISKD_BASE_URL  - Gateway URL (default: http://apis-service:3000)
 *   API_KEY         - API key (default: key-dev-1234567890)
 *   WORKSPACE_ID    - Workspace ID (default: dev-user-id)
 *   PROJECT_ID      - Project ID (default: sdk-validation)
 *
 * Run (inside Tilt):
 *   This script is designed to run as a Tilt local_resource or via
 *   kubectl exec into a pod that can reach apis-service:3000.
 *
 * Run (local with port-forward):
 *   kubectl port-forward -n diskd-local svc/apis-service 3000:3000 &
 *   DISKD_BASE_URL=http://localhost:3000 bun run scripts:build && node dist-scripts/validate-internal.js
 */
import { StreamProtocolHandler } from '../src/agentHub/StreamProtocolHandler.js';
import { diskd } from '../src/sdk/diskd.js';
const API_KEY = process.env.API_KEY ?? 'key-dev-1234567890';
const WORKSPACE_ID = process.env.WORKSPACE_ID ?? 'dev-user-id';
const PROJECT_ID = process.env.PROJECT_ID ?? 'sdk-validation';
const BASE_URL = process.env.DISKD_BASE_URL ?? 'http://apis-service:3000';
let passed = 0;
let failed = 0;
const ok = (name, detail) => {
    passed++;
    console.log(`  [PASS] ${name}${detail ? ` -- ${detail}` : ''}`);
};
const fail = (name, err) => {
    failed++;
    console.log(`  [FAIL] ${name} -- ${String(err)}`);
};
// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
console.log('=== apis-service validation (internal / API key) ===\n');
console.log(`Gateway: ${BASE_URL}`);
console.log(`Workspace: ${WORKSPACE_ID}`);
console.log(`Project: ${PROJECT_ID}\n`);
const auth = diskd.auth.apiKey({
    apiKey: API_KEY,
    workspaceId: WORKSPACE_ID,
});
ok('auth.apiKey', 'headers configured');
// ---------------------------------------------------------------------------
// 1. Drive: init, write, read, patch, delete
// ---------------------------------------------------------------------------
console.log('\n--- Drive (os/drive) ---');
const driveUrl = `${BASE_URL}/os/drive/api/v1`;
const drive = diskd.os.drive({ version: 'v1', auth, url: driveUrl });
try {
    await drive.init();
    ok('drive.init');
}
catch (err) {
    fail('drive.init', err);
}
const testContent = `validation test ${Date.now()}`;
const testBytes = new TextEncoder().encode(testContent);
let testInode = '';
try {
    const uploadResult = await drive.upload.file({
        name: 'validation-test.txt',
        data: testBytes,
        mimeType: 'text/plain',
    });
    testInode = uploadResult.inode;
    ok('drive.upload', `inode=${testInode}`);
}
catch (err) {
    fail('drive.upload', err);
}
if (testInode) {
    try {
        const downloadResult = await drive.download.file({ inode: testInode });
        const chunks = [];
        const reader = downloadResult.stream.getReader();
        let readDone = false;
        while (!readDone) {
            const { done, value } = await reader.read();
            if (done) {
                readDone = true;
            }
            else {
                chunks.push(value);
            }
        }
        const downloaded = new TextDecoder().decode(Buffer.concat(chunks));
        if (downloaded === testContent) {
            ok('drive.download', 'content matches');
        }
        else {
            fail('drive.download', `content mismatch: got "${downloaded.slice(0, 50)}"`);
        }
    }
    catch (err) {
        fail('drive.download', err);
    }
    // Apply patch (write new version)
    const patchContent = `${testContent}\npatched line`;
    const patchBytes = new TextEncoder().encode(patchContent);
    try {
        const patchResult = await drive.upload.file({
            name: 'validation-test.txt',
            data: patchBytes,
            mimeType: 'text/plain',
        });
        ok('drive.patch (re-upload)', `new inode=${patchResult.inode}`);
        testInode = patchResult.inode;
    }
    catch (err) {
        fail('drive.patch', err);
    }
    // Cleanup
    try {
        await drive.delete({ inodes: [testInode], recursive: false });
        ok('drive.delete');
    }
    catch (err) {
        fail('drive.delete', err);
    }
}
// ---------------------------------------------------------------------------
// 2. LLM: completion with upgraide::small
// ---------------------------------------------------------------------------
console.log('\n--- LLM Router (os/llm) ---');
const llmUrl = `${BASE_URL}/os/llm`;
const llm = diskd.os.llm({ auth, url: llmUrl });
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
}
catch (err) {
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
        if (delta)
            streamedText += delta;
    }
    ok('llm.completions.stream', `streamed ${streamedText.length} chars: "${streamedText.trim()}"`);
}
catch (err) {
    fail('llm.completions.stream', err);
}
// ---------------------------------------------------------------------------
// 3. Agent Hub: list agents, invoke research agent
// ---------------------------------------------------------------------------
console.log('\n--- Agent Hub (os/agents) ---');
const agentHubUrl = `${BASE_URL}/os/agents`;
const agentHub = diskd.os.agents({ auth, workspaceId: WORKSPACE_ID, url: agentHubUrl });
let researchAgentId = '';
try {
    const agents = await agentHub.agents.list();
    ok('agentHub.agents.list', `found ${agents.length} agent(s)`);
    const research = agents.find((a) => a.id.includes('research') || a.displayName.toLowerCase().includes('research'));
    if (research) {
        researchAgentId = research.id;
        ok('agentHub.findResearchAgent', `id=${research.id}, name="${research.displayName}"`);
    }
    else if (agents.length > 0) {
        researchAgentId = agents[0].id;
        ok('agentHub.findResearchAgent', `no research agent found, using first: ${agents[0].id} "${agents[0].displayName}"`);
    }
}
catch (err) {
    fail('agentHub.agents.list', err);
}
if (researchAgentId) {
    try {
        let responseText = '';
        let tokenInfo = '';
        const handler = new StreamProtocolHandler()
            .on('response.output_text.delta', (e) => {
            responseText += e.delta;
        })
            .on('response.completed', (e) => {
            if (e.response.usage) {
                const u = e.response.usage;
                tokenInfo = `${u.input_tokens}in/${u.output_tokens}out`;
            }
        })
            .on('response.failed', (e) => {
            throw new Error(e.response.error.message);
        })
            .on('error', (e) => {
            throw new Error(e.message);
        });
        const stream = await agentHub.invoke({
            agentName: researchAgentId,
            query: 'What is the capital of Japan? Reply in one sentence.',
            agentOptions: { maxTokens: 128, temperature: 0 },
        });
        await new Promise((resolve, reject) => {
            stream
                .map((event) => handler.handle(event))
                .stop(() => resolve())
                .catch((err) => reject(err));
        });
        ok('agentHub.invoke', `agent=${researchAgentId}, ${tokenInfo}, reply="${responseText.slice(0, 80)}"`);
    }
    catch (err) {
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
