/**
 * Telegram Userbot SDK -- internal service example
 *
 * Demonstrates channel resolution, listing, message fetching, and stats
 * using the diskd.tgUserbot() factory with API key auth.
 *
 * Environment:
 *   TG_USERBOT_URL   - Telegram Userbot service URL (default: http://localhost:8000)
 *   TG_API_KEY       - API key (default: key-dev-1234567890)
 *   WORKSPACE_ID     - Workspace ID (default: dev-user-id)
 *
 * Run:
 *   npm run examples:build && node dist-examples/node/tg-userbot-example.js
 */

import { createApiKeyAuth } from '../../src/auth/createApiKeyAuth.js';
import { diskd } from '../../src/sdk/diskd.js';

// ---------------------------------------------------------------------------
// Configuration from environment
// ---------------------------------------------------------------------------

const TG_USERBOT_URL = process.env.TG_USERBOT_URL ?? 'http://localhost:8000';
const TG_API_KEY = process.env.TG_API_KEY ?? 'key-dev-1234567890';
const WORKSPACE_ID = process.env.WORKSPACE_ID ?? 'dev-user-id';

// ---------------------------------------------------------------------------
// Create Telegram Userbot client via diskd factory
// ---------------------------------------------------------------------------

const auth = createApiKeyAuth({
  apiKey: TG_API_KEY,
  workspaceId: WORKSPACE_ID,
});

const tg = diskd.tgUserbot({ auth, workspaceId: WORKSPACE_ID, url: TG_USERBOT_URL });

console.log(`Connecting to Telegram Userbot at ${TG_USERBOT_URL}`);
console.log(`Workspace: ${WORKSPACE_ID}\n`);

// ---------------------------------------------------------------------------
// 1. Resolve a channel (public, no auth required)
// ---------------------------------------------------------------------------

console.log('=== 1. Resolve channel ===');

const CHANNEL_TO_RESOLVE = process.env.TG_CHANNEL ?? 'durov';

try {
  const resolved = await tg.channels.resolve(CHANNEL_TO_RESOLVE);
  console.log(`[ok] Resolved "${CHANNEL_TO_RESOLVE}":`);
  console.log(`     Telegram ID : ${resolved.telegramId}`);
  console.log(`     Title       : ${resolved.title}`);
  console.log(`     Username    : ${resolved.username ?? '(none)'}`);
  console.log(`     Public      : ${resolved.isPublic}`);
  console.log(`     Participants: ${resolved.participantsCount ?? 'unknown'}`);
} catch (err) {
  console.log(`[error] Could not resolve "${CHANNEL_TO_RESOLVE}": ${err instanceof Error ? err.message : String(err)}`);
}

// ---------------------------------------------------------------------------
// 2. List channels in workspace
// ---------------------------------------------------------------------------

console.log('\n=== 2. List channels ===');

const channels = await tg.channels.list();

console.log(`[ok] ${channels.length} channel(s) in workspace`);
for (const ch of channels.slice(0, 5)) {
  console.log(`     [${ch.id}] ${ch.title} (tg:${ch.telegramId}) status=${ch.status} messages=${ch.totalMessages}`);
}
if (channels.length > 5) {
  console.log(`     ... and ${channels.length - 5} more`);
}

// ---------------------------------------------------------------------------
// 3. Get channel status and messages (if any channels exist)
// ---------------------------------------------------------------------------

const firstChannel = channels[0];

if (firstChannel) {
  console.log(`\n=== 3. Channel status: "${firstChannel.title}" ===`);

  const status = await tg.channels.getStatus(firstChannel.id);
  console.log(`[ok] Status: ${status.channelStatus}`);
  if (status.lastTask) {
    console.log(`     Last task: ${status.lastTask.taskUuid} (${status.lastTask.status})`);
    console.log(`     Progress : ${status.lastTask.progressPercentage}%`);
  }

  // ---------------------------------------------------------------------------
  // 4. Get channel stats
  // ---------------------------------------------------------------------------

  console.log(`\n=== 4. Channel stats ===`);

  const stats = await tg.channels.getStats(firstChannel.id);
  console.log(`[ok] Total messages: ${stats.totalMessages}`);
  if (stats.dateRange) {
    console.log(`     Date range: ${stats.dateRange.earliest} -- ${stats.dateRange.latest}`);
  }

  // ---------------------------------------------------------------------------
  // 5. Fetch recent messages
  // ---------------------------------------------------------------------------

  console.log(`\n=== 5. Recent messages ===`);

  const messagesResult = await tg.channels.getMessages(firstChannel.id, { limit: 5 });
  console.log(`[ok] ${messagesResult.totalMessagesInDb} total in DB, showing ${messagesResult.messages.length}`);

  for (const msg of messagesResult.messages) {
    const sender = msg.senderName ?? `id:${msg.senderId ?? 'unknown'}`;
    const text = msg.text?.slice(0, 80) ?? '(no text)';
    console.log(`     [${msg.date}] ${sender}: ${text}`);
  }
} else {
  console.log('\n=== 3-5. Channel details ===');
  console.log('[skip] No channels in workspace');
}

// ---------------------------------------------------------------------------
// 6. List running tasks
// ---------------------------------------------------------------------------

console.log('\n=== 6. Running tasks ===');

const tasksResult = await tg.tasks.list();
const taskEntries = Object.entries(tasksResult.runningTasks);
console.log(`[ok] ${taskEntries.length} running task(s)`);
for (const [uuid, task] of taskEntries.slice(0, 3)) {
  console.log(`     ${uuid}: ${task.status} (${task.progressPercentage}%)`);
}

console.log('\n[done] All Telegram Userbot operations completed successfully');
