/**
 * Drive Session SDK -- internal service example
 *
 * Connects directly to the Drive service using API key auth.
 * Use this pattern for services running inside the Tilt cluster
 * or connecting to localhost port-forwards.
 *
 * Environment:
 *   DRIVE_API_URL       - Drive service URL (default: http://localhost:8000/api/v1)
 *   DRIVE_API_KEY       - API key (default: key-dev-1234567890)
 *   DRIVE_WORKSPACE_ID  - Workspace ID (default: dev-user-id)
 *   DRIVE_ORG_ID        - Organization ID (default: dev-org-id)
 *   DRIVE_PROJECT_ID    - Project ID to use (default: sdk-test)
 *
 * Run:
 *   npm run examples:build && node dist-examples/node/drive-session-internal.js
 */

import { diskd } from '@diskd/sdk';

// ---------------------------------------------------------------------------
// Configuration from environment
// ---------------------------------------------------------------------------

const DRIVE_API_URL = process.env.DRIVE_API_URL ?? 'http://localhost:8000/api/v1';
const DRIVE_API_KEY = process.env.DRIVE_API_KEY ?? 'key-dev-1234567890';
const DRIVE_WORKSPACE_ID = process.env.DRIVE_WORKSPACE_ID ?? 'dev-user-id';
const DRIVE_ORG_ID = process.env.DRIVE_ORG_ID ?? 'dev-org-id';
const PROJECT_ID = process.env.DRIVE_PROJECT_ID ?? 'sdk-test';

// ---------------------------------------------------------------------------
// Create Drive client with API key auth (internal service pattern)
// ---------------------------------------------------------------------------

const auth = diskd.auth.apiKey({
  apiKey: DRIVE_API_KEY,
  workspaceId: DRIVE_WORKSPACE_ID,
  orgId: DRIVE_ORG_ID,
});

const drive = diskd.drive({ version: 'v1', auth, url: DRIVE_API_URL });
const sessions = diskd.session({ auth, url: DRIVE_API_URL });

console.log(`Connecting to Drive at ${DRIVE_API_URL}`);
console.log(`Project: ${PROJECT_ID}\n`);

// ---------------------------------------------------------------------------
// 1. Ensure drive is initialized and project exists
// ---------------------------------------------------------------------------

await drive.init();
console.log('[ok] Drive initialized');

// Ensure /Projects/{PROJECT_ID} folder exists
const rootItems = await drive.list({ path: '/' });
const hasProjects = rootItems.some((e) => e.name === 'Projects');

if (!hasProjects) {
  // Projects folder will be created by the session save (the backend handles it).
  // For non-session operations we would need to create it manually.
}

// Try to list the project folder; if it doesn't exist the session save will create .sessions
try {
  await drive.list({ path: `/Projects/${PROJECT_ID}` });
} catch {
  // Project folder may not exist yet -- session save creates it automatically
}
console.log(`[ok] Project folder /Projects/${PROJECT_ID} ready`);

// ---------------------------------------------------------------------------
// 2. Start a new session
// ---------------------------------------------------------------------------

const session = await sessions.start({ projectId: PROJECT_ID, title: 'SDK Integration Test', workspaceId: DRIVE_ORG_ID });
console.log(`[ok] Started session: ${session.sessionId}`);

// ---------------------------------------------------------------------------
// 3. Append messages
// ---------------------------------------------------------------------------

await session.append([
  sessions.message({ role: 'user', content: 'How do I deploy to production?' }),
]);
console.log(`[ok] Appended user message (count: ${session.messageCount})`);

await session.append([
  sessions.message({ role: 'assistant', content: 'Here are the deployment steps:\n1. Build the image\n2. Push to registry\n3. Update k8s manifests\n4. Apply with kubectl' }),
]);
console.log(`[ok] Appended assistant message (count: ${session.messageCount})`);

await session.append([
  sessions.message({ role: 'user', content: 'What about rollback?' }),
  sessions.message({ role: 'assistant', content: 'To rollback, use: kubectl rollout undo deployment/<name>' }),
]);
console.log(`[ok] Appended turn pair (count: ${session.messageCount})`);

// ---------------------------------------------------------------------------
// 4. Open with preview (newest N messages)
// ---------------------------------------------------------------------------

const preview = await sessions.open({ projectId: PROJECT_ID, sessionId: session.sessionId, limit: 2 });
console.log(`[ok] Opened preview: ${preview.messages.length} messages loaded, ${preview.messageCount} total`);

// ---------------------------------------------------------------------------
// 5. Load more (older messages)
// ---------------------------------------------------------------------------

const older = await preview.loadMore({ limit: 10 });
console.log(`[ok] Loaded ${older.messages.length} older messages, hasMore: ${older.hasMore}`);
console.log(`     Total loaded: ${preview.messages.length}`);

preview.dispose();

// ---------------------------------------------------------------------------
// 6. Fork session
// ---------------------------------------------------------------------------

const full = await sessions.open({ projectId: PROJECT_ID, sessionId: session.sessionId });
const forkPointId = full.messages[1]!.id; // fork after first assistant response
const forked = await full.fork({ atMessageId: forkPointId });
console.log(`[ok] Forked session: ${forked.sessionId}`);
console.log(`     Fork source: ${forked.document.forkSourceSessionId}`);
console.log(`     Fork point: ${forked.document.forkSourceMessageId}`);
console.log(`     Messages copied: ${forked.messages.length}`);

await forked.append([
  sessions.message({ role: 'user', content: 'Actually, let me try a different approach...' }),
]);
console.log(`[ok] Appended to forked session (count: ${forked.messageCount})`);

forked.dispose();
full.dispose();

// ---------------------------------------------------------------------------
// 7. Rollback (undo last turn)
// ---------------------------------------------------------------------------

const rollbackSession = await sessions.open({ projectId: PROJECT_ID, sessionId: session.sessionId });
const rollbackPoint = rollbackSession.messages[rollbackSession.messages.length - 2]!.id;
await rollbackSession.rollback(rollbackPoint);
console.log(`[ok] Rolled back after ${rollbackPoint}`);
console.log(`     Messages remaining: ${rollbackSession.messages.length}`);

rollbackSession.dispose();

// ---------------------------------------------------------------------------
// 8. Remove specific messages
// ---------------------------------------------------------------------------

const editSession = await sessions.open({ projectId: PROJECT_ID, sessionId: session.sessionId });
if (editSession.messages.length > 1) {
  const toRemove = editSession.messages[1]!.id;
  await editSession.remove([toRemove]);
  console.log(`[ok] Removed message ${toRemove}`);
  console.log(`     Messages remaining: ${editSession.messages.length}`);
}

editSession.dispose();

// ---------------------------------------------------------------------------
// 9. List sessions
// ---------------------------------------------------------------------------

const listResult = await sessions.list({ projectId: PROJECT_ID });
console.log(`\n[ok] Sessions in project "${PROJECT_ID}":`);
for (const item of listResult.items) {
  console.log(`     - ${item.sessionId}: "${item.title ?? '(untitled)'}" (${item.messageCount} msgs)`);
}

// ---------------------------------------------------------------------------
// 10. Refresh and verify final state
// ---------------------------------------------------------------------------

const finalSession = await sessions.open({ projectId: PROJECT_ID, sessionId: session.sessionId });
console.log(`\n[ok] Final session state:`);
console.log(`     ID: ${finalSession.sessionId}`);
console.log(`     Title: ${finalSession.document.title}`);
console.log(`     Messages: ${finalSession.messageCount}`);
for (const msg of finalSession.messages) {
  console.log(`     [${msg.role}] ${msg.content.slice(0, 60)}${msg.content.length > 60 ? '...' : ''}`);
}

finalSession.dispose();
session.dispose();

console.log('\n[done] All operations completed successfully');
