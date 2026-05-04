/**
 * Contacts SDK -- example: create, list, search, update, archive, delete contacts
 *
 * Usage (OAuth2 via apis-service):
 *   bun run examples:build && NODE_TLS_REJECT_UNAUTHORIZED=0 node dist-examples/node/contacts-example.js [credentials-path]
 *
 * Usage (API key via port-forward):
 *   kubectl -n dev port-forward svc/app-service 3099:3001
 *   CONTACTS_URL=http://localhost:3099 APIS_API_KEY=<key> DISKD_WORKSPACE_ID=<ws> npx tsx examples/node/contacts-example.ts
 *
 * Environment:
 *   DISKD_CREDENTIALS_PATH  - Path to OAuth2 credentials.json (default: ../../.agents/credentials.json)
 *   CONTACTS_URL            - Override contacts base URL
 *   APIS_API_KEY            - API key for direct app-service access (skips OAuth2)
 *   DISKD_WORKSPACE_ID      - Workspace ID (required with APIS_API_KEY)
 */
import path from 'node:path';
import type { AuthModule, Contact } from '@diskd-ai/sdk';
import { diskd } from '@diskd-ai/sdk';

const contactsUrl =
  process.env.CONTACTS_URL ??
  `${process.env.APIS_BASE_URL ?? 'https://apis.upgraide.dev'}/v1/platform/contacts`;

const apiKey = process.env.APIS_API_KEY;
const workspaceId = process.env.DISKD_WORKSPACE_ID;

let auth: AuthModule;
if (apiKey && workspaceId) {
  console.log(`[auth] Using API key mode (workspace: ${workspaceId})`);
  auth = diskd.auth.apiKey({ workspaceId });
} else {
  const credentialsPath =
    process.argv[2] ??
    process.env.DISKD_CREDENTIALS_PATH ??
    path.resolve(process.cwd(), 'credentials.json');
  console.log(`[auth] Using OAuth2 credentials: ${credentialsPath}`);
  auth = await diskd.auth.credentials({ scopes: ['openid'], keyfilePath: credentialsPath });
}

console.log(`[info] Contacts URL: ${contactsUrl}`);
const contacts = diskd.platform.contacts({ auth, url: contactsUrl });

// -- Step 1: List existing contacts --
console.log('\n--- List contacts ---');
const existing = await contacts.list();
console.log(`[ok] Found ${existing.length} existing contact(s)`);
for (const c of existing) {
  console.log(`  - [${c.id}] "${c.displayName}" source=${c.source} archived=${c.isArchived}`);
}

// -- Step 2: Create a contact --
console.log('\n--- Create contact ---');
const created: Contact = await contacts.create({
  displayName: 'Alice Johnson',
  givenName: 'Alice',
  familyName: 'Johnson',
  title: 'Engineering Lead',
  tags: ['partner', 'engineering'],
  source: 'manual',
});

console.log(`[ok] Created contact:`);
console.log(`  ID:          ${created.id}`);
console.log(`  DisplayName: ${created.displayName}`);
console.log(`  GivenName:   ${created.givenName}`);
console.log(`  FamilyName:  ${created.familyName}`);
console.log(`  Title:       ${created.title}`);
console.log(`  Tags:        ${JSON.stringify(created.tags)}`);
console.log(`  Source:      ${created.source}`);
console.log(`  Methods:     ${created.methods.length}`);
console.log(`  Links:       ${created.projectLinks.length}`);

// -- Step 3: Add email method --
console.log('\n--- Add email method ---');
const withEmail: Contact = await contacts.methods.add(created.id, {
  type: 'email',
  value: 'alice@example.com',
  isPrimary: true,
});

console.log(`[ok] Added email. Methods now:`);
for (const m of withEmail.methods) {
  console.log(`  - [${m.id}] ${m.type}: ${m.value} (primary=${m.isPrimary})`);
}

// -- Step 4: Add phone method --
console.log('\n--- Add phone method ---');
const withPhone: Contact = await contacts.methods.add(created.id, {
  type: 'phone',
  value: '+1-555-0123',
});

console.log(`[ok] Added phone. Methods now: ${withPhone.methods.length}`);
for (const m of withPhone.methods) {
  console.log(`  - [${m.id}] ${m.type}: ${m.value} (primary=${m.isPrimary})`);
}

// -- Step 5: Update the contact --
console.log('\n--- Update contact ---');
const updated: Contact = await contacts.update(created.id, {
  title: 'VP of Engineering',
  tags: ['partner', 'engineering', 'vip'],
});

console.log(`[ok] Updated contact:`);
console.log(`  Title: ${updated.title}`);
console.log(`  Tags:  ${JSON.stringify(updated.tags)}`);

// -- Step 6: Search contacts --
console.log('\n--- Search contacts ---');
const searchResults = await contacts.search({ query: 'Alice' });
console.log(`[ok] Search "Alice" returned ${searchResults.length} result(s)`);
for (const c of searchResults) {
  console.log(`  - [${c.id}] "${c.displayName}"`);
}

// -- Step 7: Get contact by ID --
console.log('\n--- Get contact by ID ---');
const fetched = await contacts.get(created.id);
console.log(`[ok] Fetched contact: "${fetched.displayName}"`);
console.log(`  Title:   ${fetched.title}`);
console.log(`  Tags:    ${JSON.stringify(fetched.tags)}`);
console.log(`  Methods: ${fetched.methods.length}`);
console.log(`  Links:   ${fetched.projectLinks.length}`);

// -- Step 8: Archive the contact --
console.log('\n--- Archive contact ---');
const archived: Contact = await contacts.archive(created.id);
console.log(`[ok] Archived: isArchived=${archived.isArchived}`);

// -- Step 9: List archived contacts --
console.log('\n--- List archived contacts ---');
const archivedList = await contacts.list({ isArchived: true });
console.log(`[ok] Found ${archivedList.length} archived contact(s)`);

// -- Step 10: Delete the contact --
console.log('\n--- Delete contact ---');
await contacts.delete(created.id);
console.log(`[ok] Deleted contact ${created.id}`);

// -- Step 11: Verify deletion --
console.log('\n--- Verify deletion ---');
const afterDelete = await contacts.list();
const stillExists = afterDelete.some((c) => c.id === created.id);
console.log(`[ok] Contact still exists: ${stillExists}`);

console.log('\n[done] Contacts example completed successfully');
