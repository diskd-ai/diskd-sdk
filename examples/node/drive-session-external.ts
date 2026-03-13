/**
 * Drive Session SDK -- external client example (OAuth2)
 *
 * Connects to the Drive service via the public gateway (apis.diskd.local)
 * using OAuth2 service-account credentials.
 *
 * Environment:
 *   DISKD_BASE_URL          - Gateway URL (default: https://apis.diskd.local:8080)
 *   DISKD_CREDENTIALS_PATH  - Path to OAuth2 credentials.json
 *   DISKD_PROJECT_ID        - Project ID (default: my-project)
 *
 * Run:
 *   DISKD_BASE_URL=https://apis.diskd.local:8080 \
 *   npm run examples:build && node dist-examples/node/drive-session-external.js
 */
import path from 'node:path';

import { diskd } from '@diskd/sdk';

// ---------------------------------------------------------------------------
// Configuration from environment
// ---------------------------------------------------------------------------

const scopes = ['openid'];
const credentialsPath =
  process.argv[2] ??
  process.env.DISKD_CREDENTIALS_PATH ??
  path.resolve(process.cwd(), 'credentials.json');

const PROJECT_ID = process.env.DISKD_PROJECT_ID ?? 'my-project';

// ---------------------------------------------------------------------------
// Create Drive client with OAuth2 auth (external client pattern)
// ---------------------------------------------------------------------------

const auth = await diskd.auth.credentials({ scopes, keyfilePath: credentialsPath });
const drive = diskd.drive({ version: 'v1', auth });
const sessions = diskd.session({ auth });

console.log(`Connecting to Drive via gateway`);
console.log(`Project: ${PROJECT_ID}\n`);

// ---------------------------------------------------------------------------
// 1. Ensure drive is initialized
// ---------------------------------------------------------------------------

await drive.init();
console.log('[ok] Drive initialized');

// ---------------------------------------------------------------------------
// 2. Start a new session
// ---------------------------------------------------------------------------

const session = await sessions.start({ projectId: PROJECT_ID, title: 'Deployment help' });
console.log(`[ok] Started session: ${session.sessionId}`);

// ---------------------------------------------------------------------------
// 3. Append messages
// ---------------------------------------------------------------------------

await session.append([
  sessions.message({ role: 'user', content: 'How do I deploy to production?' }),
]);
console.log(`[ok] Appended user message (count: ${session.messageCount})`);

await session.append([
  sessions.message({ role: 'assistant', content: 'Here are the steps to deploy...' }),
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

const preview = await sessions.open({
  projectId: PROJECT_ID,
  sessionId: session.sessionId,
  limit: 2,
});
console.log(`[ok] Opened preview: ${preview.messages.length} messages loaded, ${preview.messageCount} total`);

// ---------------------------------------------------------------------------
// 5. Load more (older messages)
// ---------------------------------------------------------------------------

if (preview.messageCount > preview.messages.length) {
  const older = await preview.loadMore({ limit: 20 });
  console.log(`[ok] Loaded ${older.messages.length} older messages, hasMore: ${older.hasMore}`);
  console.log(`     Total loaded: ${preview.messages.length}`);
}

preview.dispose();

// ---------------------------------------------------------------------------
// 6. Fork session
// ---------------------------------------------------------------------------

const full = await sessions.open({ projectId: PROJECT_ID, sessionId: session.sessionId });
if (full.messages.length > 1) {
  const forkPointId = full.messages[1]!.id;
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
}
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
// 10. Delete session
// ---------------------------------------------------------------------------

await sessions.delete({ projectId: PROJECT_ID, sessionId: session.sessionId });
console.log(`\n[ok] Deleted session ${session.sessionId}`);

session.dispose();

// ---------------------------------------------------------------------------
// 11. Migration: import existing chats (stateless save)
// ---------------------------------------------------------------------------

// save() is stateless -- use it for bulk import / migration
const importResult = await sessions.save({
  projectId: PROJECT_ID,
  session: {
    id: 'imported-session-001',
    workspaceId: 'ws-1',
    projectId: PROJECT_ID,
    title: 'Imported from legacy system',
    config: {
      operativeId: null,
      provider: 'openai',
      model: 'gpt-4',
      promptText: null,
      driveSourcesMuted: false,
    },
    exchanges: [],
    participants: [],
    messages: [
      sessions.message({ id: 'legacy-msg-1', role: 'user', content: 'Original user message' }),
      sessions.message({ id: 'legacy-msg-2', role: 'assistant', content: 'Original AI response' }),
    ],
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    sourceOrigin: 'legacy-import',
    forkSourceSessionId: null,
    forkSourceMessageId: null,
  },
});

console.log(`\n[ok] Imported session: ${importResult.sessionId} (${importResult.messageCount} messages)`);

console.log('\n[done] All operations completed successfully');
