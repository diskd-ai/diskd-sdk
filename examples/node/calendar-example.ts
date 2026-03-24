/**
 * Calendar SDK -- example: create, list, update events
 *
 * Usage:
 *   bun run examples:build && NODE_TLS_REJECT_UNAUTHORIZED=0 node dist-examples/node/calendar-example.js [credentials-path]
 *
 * Environment:
 *   DISKD_CREDENTIALS_PATH  - Path to OAuth2 credentials.json (default: ../../.agents/credentials.json)
 *   CALENDAR_URL             - Override calendar base URL
 */
import path from 'node:path';

import { diskd } from '@diskd/sdk';
import type { CalendarEvent } from '@diskd/sdk';

const scopes = ['openid'];
const credentialsPath =
  process.argv[2] ??
  process.env.DISKD_CREDENTIALS_PATH ??
  path.resolve(process.cwd(), 'credentials.json');

const calendarUrl =
  process.env.CALENDAR_URL ??
  `${process.env.APIS_BASE_URL ?? 'https://apis.upgraide.dev'}/v1/platform/calendar`;

console.log(`[auth] Using credentials: ${credentialsPath}`);
console.log(`[info] Calendar URL: ${calendarUrl}`);

const auth = await diskd.auth.credentials({ scopes, keyfilePath: credentialsPath });
const calendar = diskd.platform.calendar({ auth, url: calendarUrl });

// -- Step 1: List accounts to find a calendar ID --
console.log('\n--- List accounts ---');
const accounts = await calendar.listAccounts();
console.log(`[ok] Found ${accounts.length} account(s)`);

if (accounts.length === 0) {
  console.error('[error] No calendar accounts found. Set up a calendar account first.');
  process.exit(1);
}

for (const account of accounts) {
  console.log(`  Account: ${account.email} (${account.provider}, status=${account.status})`);
  for (const cal of account.calendars) {
    console.log(`    Calendar: ${cal.id} "${cal.name}" color=${cal.color} visible=${cal.isVisible}`);
  }
}

const defaultCalendar = accounts[0].calendars[0];
if (!defaultCalendar) {
  console.error('[error] No calendars found in first account.');
  process.exit(1);
}
console.log(`[info] Using calendar: "${defaultCalendar.name}" (${defaultCalendar.id})`);

// -- Step 2: Create an event --
console.log('\n--- Create event ---');
const created: CalendarEvent = await calendar.createEvent({
  calendarId: defaultCalendar.id,
  title: 'deployment kick off',
  startAt: '2026-03-22T18:15:00Z',
  endAt: '2026-03-22T19:15:00Z',
  timezoneId: 'Europe/Moscow',
});

console.log(`[ok] Created event:`);
console.log(`  ID:    ${created.id}`);
console.log(`  Title: ${created.title}`);
console.log(`  Start: ${created.startAt}`);
console.log(`  End:   ${created.endAt}`);
console.log(`  Status: ${created.status}`);

// -- Step 3: List events for today --
console.log('\n--- List events for today ---');
const events = await calendar.listEvents({
  startAfter: '2026-03-21T21:00:00Z',
  startBefore: '2026-03-22T21:00:00Z',
});

console.log(`[ok] Found ${events.length} event(s) for 2026-03-22:`);
for (const event of events) {
  console.log(`  - [${event.id}] "${event.title}" ${event.startAt} -> ${event.endAt}`);
  if (event.description) {
    console.log(`    Description: ${event.description}`);
  }
}

// -- Step 4: Update the event with a description --
console.log('\n--- Update event with description ---');
const updated: CalendarEvent = await calendar.updateEvent(created.id, {
  description: 'Kick off the v2.4 production deployment. Review rollback plan and monitoring dashboards before proceeding.',
});

console.log(`[ok] Updated event:`);
console.log(`  ID:          ${updated.id}`);
console.log(`  Title:       ${updated.title}`);
console.log(`  Description: ${updated.description}`);
console.log(`  Start:       ${updated.startAt}`);
console.log(`  End:         ${updated.endAt}`);

// -- Step 5: Verify by fetching the single event --
console.log('\n--- Get event by ID ---');
const fetched = await calendar.getEvent(created.id);
console.log(`[ok] Fetched event: "${fetched.title}"`);
console.log(`  Description: ${fetched.description}`);
console.log(`  Attendees:   ${fetched.attendees.length}`);
console.log(`  NoteLinks:   ${fetched.noteLinks.length}`);
console.log(`  Attachments: ${fetched.attachments.length}`);

console.log('\n[done] Calendar example completed');
