# @diskd/sdk

Unified TypeScript SDK for the Upgraide platform APIs.

All services are accessible via the `diskd` factory, which provides a consistent
`diskd.auth.*` + namespaced service pattern across `diskd.os.*`, `diskd.platform.*`,
and `diskd.utils.*`:

```ts
import { diskd } from '@diskd/sdk';

const auth = diskd.auth.apiKey({ workspaceId: '...' });

const drive      = diskd.os.drive({ version: 'v1', auth });
const sessions   = diskd.platform.sessions({
  auth,
  scope: { scopeType: 'project', projectId: 'proj-1' },
});
const crontab    = diskd.platform.crontab({
  auth,
  scope: { scopeType: 'project', projectId: 'proj-1' },
});
const db         = diskd.os.database({ auth, dbName: '...', schema: { ... } });
const ds         = diskd.os.datasource({ auth, dbName: '...', entities: [...] });
const llm        = diskd.os.llm({ auth });
const agents     = diskd.os.agents({ auth, workspaceId: '...' });
const mcp        = diskd.os.mcp({ auth, workspaceId: '...' });
const routines   = diskd.platform.routines({ auth });
const operatives = diskd.platform.operatives({ auth });
const calendar   = diskd.platform.calendar({ auth });
const tg         = diskd.utils.tgUserBot({ auth, workspaceId: '...' });
const webNav     = diskd.utils.webNavigator({ auth, workspaceId: '...' });
```

Installation
------------

1. Configure `.npmrc` in your project (or `~/.npmrc`):

   ```ini
   @diskd:registry=https://gitlab.iosya.com/api/v4/projects/80/packages/npm/
   //gitlab.iosya.com/api/v4/projects/80/packages/npm/:_authToken=${NPM_TOKEN}
   ```

2. Set `NPM_TOKEN` to a GitLab personal access token with `read_api` scope:

   ```bash
   export NPM_TOKEN=glpat-xxxxxxxxxxxx
   ```

3. Install:

   ```bash
   bun add @diskd/sdk
   ```

Install / build (repo)
----------------------

```bash
cd mono/platform-api
bun install
bun run build
```

Authentication
--------------

The SDK supports two authentication modes via the `AuthModule` interface.

### External clients (OAuth2)

Use `diskd.auth.credentials()` for OAuth2 service-account or PKCE browser flows:

```ts
import { diskd } from '@diskd/sdk';

const auth = await diskd.auth.credentials({
  scopes: ['openid'],
  keyfilePath: 'credentials.json',
});

const drive = diskd.os.drive({ version: 'v1', auth });
const sessions = diskd.platform.sessions({
  auth,
  scope: { scopeType: 'project', projectId: 'proj-1' },
});
const crontab = diskd.platform.crontab({
  auth,
  scope: { scopeType: 'project', projectId: 'proj-1' },
});
```

### Internal services (API key)

Use `diskd.auth.apiKey()` for service-to-service communication within the cluster:

```ts
import { diskd } from '@diskd/sdk';

const auth = diskd.auth.apiKey({ workspaceId: process.env.WORKSPACE_ID! });

const drive = diskd.os.drive({ version: 'v1', auth });
```

`diskd.auth.apiKey()` reads `APIS_API_KEY` from the environment and fails fast when
either `APIS_API_KEY` or `APIS_BASE_URL` is missing.

Both auth modes produce identical client instances.

Environment variables
---------------------

All resource APIs resolve from the centralized gateway base URL:

| Env Variable | Default |
|--------------|---------|
| `APIS_BASE_URL` | `https://apis.diskd.local:8080` |
| `APIS_API_KEY` | none |

The gateway is the single resource entrypoint. Public gateway URLs follow the
versioned convention `https://apis.example/v1/{namespace}/{module}`. The SDK
derives API paths from the same namespace structure as the public SDK surface
and lets the gateway handle API orchestration and auth strategy.

Derived default paths:
- `/v1/os/drive`
- `/v1/os/database`
- `/v1/os/llm`
- `/v1/os/agents`
- `/v1/os/mcp`
- `/v1/platform/sessions`
- `/v1/platform/crontab`
- `/v1/platform/operatives`
- `/v1/platform/projects`
- `/v1/platform/routines`
- `/v1/platform/events`
- `/v1/platform/calendar`
- `/v1/utils/tg-userbot`
- `/v1/utils/web-navigator`

You can still override a client with an explicit `url`, but the default mode is
the centralized gateway.

Gateway Decision
----------------

This SDK does not treat resource APIs as independently-discovered hosts.
The canonical model is one centralized `apis` gateway behind `APIS_BASE_URL`.

That means:
- no per-service default env vars such as `LLM_ROUTER_BASE_URL`, `AGENT_HUB_BASE_URL`, or `MCP_HUB_BASE_URL`
- resource clients derive their route from `APIS_BASE_URL` plus a namespace-derived path prefix
- the gateway is responsible for request routing, API orchestration, and auth-strategy handling

Per-client `url` remains available only as an explicit override.

Drive API
---------

### Path operations

```ts
await drive.init();
const entries = await drive.list({ path: '/' });
const dir = await drive.create({ dirName: 'my-folder' });
await drive.rename({ inode: dir.inode, newName: 'renamed-folder' });
await drive.delete({ inodes: [dir.inode], recursive: true });
const resolved = await drive.resolve({ inodes: ['inode1', 'inode2'] });
await drive.updateMetadata({ inode: 'abc', metadata: { key: 'value' } });
await drive.updateAttributes({ inode: 'abc', attributes: ['pinned'] });
```

### Upload (buffer + stream)

```ts
// Buffer upload
const result = await drive.upload.file({
  name: 'hello.txt',
  data: new TextEncoder().encode('Hello, world!'),
  mimeType: 'text/plain',
  onProgress: (uploaded, total) => console.log(`${uploaded}/${total}`),
});

// Stream upload (large files)
const result = await drive.upload.file({
  name: 'large.bin',
  stream: readableStream,
  size: 1_000_000_000,
  sha256Root: 'precomputed-hex',
});
```

### Download (streaming)

```ts
const file = await drive.download.file({
  inode: 'abc123',
  onProgress: (downloaded, total) => console.log(`${downloaded}/${total}`),
});
await file.stream.pipeTo(writableStream);
```

### File metadata, disk usage, tools

```ts
const meta = await drive.files.metadata({ inode: 'abc' });
const usage = await drive.diskUsage();
const ls = await drive.tools.ls({ path: '/', recursive: true });
const grep = await drive.tools.grep({ pattern: 'TODO' });
```

### Sessions

The SDK exposes these session methods on `diskd.platform.sessions({ auth, scope })`:

- `start`
- `open`
- `save`
- `list`
- `delete`
- `message`

```ts
const session = await sessions.start({
  title: 'Deployment help',
});

await session.append([
  sessions.message({ role: 'user', content: 'How do I deploy to production?' }),
]);

const sessionList = await sessions.list();
```

### Crontab scheduler

The SDK exposes these scheduler methods on `diskd.platform.crontab({ auth, scope, timezone? })`.
If `timezone` is omitted, the SDK uses the caller runtime timezone by default.

- `save`
- `get`
- `getStatus`
- `listJobs`
- `runJob`
- `createJob`

```ts
await crontab.createJob({
  job: {
    jobId: '01JABCD2FGH3JK4MNP5QRST6VW',
    enabled: true,
    schedule: {
      minute: '*/5',
      hour: '*',
      dayOfMonth: '*',
      month: '*',
      dayOfWeek: '*',
    },
    request: {
      method: 'POST',
      url: 'https://example.internal/hooks/sync',
      payload: {
        kind: 'json',
        value: { source: 'sdk-example' },
      },
    },
  },
});

const status = await crontab.getStatus();
```

See `examples/node/drive-upload-download.ts`, `examples/node/drive-session-external.ts`, and `examples/node/drive-crontab.ts`.

Routines API
------------

REST client for managing routines (automated workflows) scoped to profile or project:

```ts
const routines = diskd.platform.routines({ auth });

// List routines in a scope
const all = await routines.list({ scope: 'workspace' });
const projectRoutines = await routines.list({ scope: 'project', projectName: 'my-project' });

// Get by slug
const routine = await routines.get({ slug: 'daily-summary', scope: 'workspace' });

// Create
const created = await routines.create({
  name: 'Daily Summary',
  scope: 'workspace',
  operativeSlug: 'research-agent',
  triggerType: 'rhythm',
  trigger: { cron: '0 9 * * *' },
  steps: [{ id: 'step-1', name: 'Summarize', action: 'summarize', order: 0 }],
});

// Update
const updated = await routines.update(
  'daily-summary',
  { status: 'paused' },
  { scopeType: 'workspace' },
);

// Delete
await routines.delete({ slug: 'daily-summary', scope: 'workspace' });
```

Operatives API
--------------

REST client for managing operatives (AI agents) with attached files, skills, and MCP tools:

```ts
const ops = diskd.platform.operatives({ auth });

// List operatives in a project
const list = await ops.list({ projectId: 'proj-1' });

// Get by id or slug
const operative = await ops.get('op-01');
const bySlug = await ops.getBySlug({ projectId: 'proj-1', slug: 'research-agent' });

// Create
const created = await ops.create({
  projectId: 'proj-1',
  name: 'Research Agent',
  engine: 'deep',
  engineProvider: 'anthropic',
  engineModel: 'claude-4',
});

// Update
await ops.update('op-01', {
  orders: 'You are a research assistant focused on academic papers.',
  fileAccess: 'selected',
});

// Delete
await ops.delete('op-01');
```

### Operative files (Drive knowledge sources)

Attach Drive files from the operative's project chroot as knowledge sources:

```ts
// Attach files (paths relative to project chroot)
await ops.files.add('op-01', { paths: ['/docs/knowledge-base', '/docs/readme.md'] });

// List attached files
const files = await ops.files.list('op-01');

// Detach a file
await ops.files.remove('op-01', files[0].id);
```

### Operative skills

```ts
// Attach skills
await ops.skills.add('op-01', { refIds: ['web-search', 'code-review'] });

// List attached skills
const skills = await ops.skills.list('op-01');

// Detach a skill
await ops.skills.remove('op-01', skills[0].id);
```

### Operative MCP tools

```ts
// Attach MCP tools
await ops.tools.add('op-01', { selectors: ['github/search_repos', 'slack/send_message'] });

// List attached tools
const tools = await ops.tools.list('op-01');

// Detach a tool
await ops.tools.remove('op-01', tools[0].id);
```

Calendar API
------------

REST client for workspace calendar management -- events, attendees, note links, attachments, and settings:

```ts
const calendar = diskd.platform.calendar({ auth });

// Accounts and events
const accounts = await calendar.listAccounts();
const events = await calendar.listEvents({
  startAfter: '2026-03-01T00:00:00Z',
  startBefore: '2026-03-31T23:59:59Z',
});

// Event CRUD
const event = await calendar.createEvent({
  calendarId: accounts[0].calendars[0].id,
  title: 'Sprint Planning',
  startAt: '2026-03-25T10:00:00Z',
  endAt: '2026-03-25T11:00:00Z',
});

await calendar.updateEvent(event.id, {
  title: 'Sprint Planning (updated)',
  metadata: { timeBlockCategory: 'meeting' },
});

await calendar.deleteEvent(event.id);
```

### Attendees

```ts
const attendee = await calendar.attendees.add(event.id, {
  email: 'alice@example.com',
  role: 'required',
});

await calendar.attendees.updateRsvp(event.id, attendee.id, 'yes');
await calendar.attendees.remove(event.id, attendee.id);
```

### Note links

```ts
const link = await calendar.noteLinks.add(event.id, {
  noteDiskPath: '/Projects/sprint/notes/planning.md',
  title: 'Planning Notes',
  linkType: 'context',
});

await calendar.noteLinks.remove(event.id, link.id);
```

### Attachments

```ts
const attachment = await calendar.attachments.add(event.id, {
  type: 'url',
  title: 'Meeting Recording',
  url: 'https://meet.example.com/recording/123',
});

await calendar.attachments.remove(event.id, attachment.id);
```

### Event metadata

Events support an extensible `metadata` JSONB field for cross-domain data:

```ts
await calendar.updateEvent(event.id, {
  metadata: {
    timeBlockCategory: 'focus',
    linkedNotes: [
      { noteDiskPath: '/docs/spec.md', title: 'Spec', linkType: 'context' },
    ],
  },
});
```

### Settings

```ts
const settings = await calendar.getSettings();
await calendar.updateSettings({
  weekStartDay: 0,
  defaultView: 'month',
  timezone: 'America/New_York',
});
```

Drive Database API
------------------

JSON-RPC client for Drive's SQLite-backed database operations:

```ts
const drive = diskd.os.drive({ version: 'v1', auth });

// Create a database with schema
const db = await drive.db.create({
  name: 'myapp.workspace-123.main',
  schema: {
    users: {
      id:    { type: 'TEXT', primaryKey: true },
      name:  { type: 'TEXT', notNull: true },
      email: { type: 'TEXT', notNull: true },
    },
  },
});

// Insert rows
await drive.db.insert({
  name: 'myapp.workspace-123.main',
  table: 'users',
  rows: [{ id: '1', name: 'Alice', email: 'alice@example.com' }],
});

// Query with parameters
const result = await drive.db.query({
  name: 'myapp.workspace-123.main',
  sql: 'SELECT * FROM users WHERE id = ?',
  parameters: ['1'],
});

// Commit, metadata, drop, resolve
await drive.db.commit({ name: 'myapp.workspace-123.main' });
const meta = await drive.db.metadata({ name: 'myapp.workspace-123.main' });
const resolved = await drive.db.resolveByInode({ dbInode: db.dbInode });
```

Drive Repository (CRUD pattern)
--------------------------------

Higher-level database + table-scoped repository pattern -- ideal for services
that use Drive DB as their persistence layer:

```ts
// Create database with schema
const db = diskd.os.database({
  auth,
  dbName: 'shop.workspace-123.main',
  dbType: 'database',
  schema: {
    users:  { id: { type: 'TEXT', primaryKey: true }, name: { type: 'TEXT', notNull: true } },
    orders: { id: { type: 'TEXT', primaryKey: true }, user_id: { type: 'TEXT' }, total: { type: 'INTEGER' } },
  },
});

await db.ensureCreated();

// Get table-scoped repositories
const users = db.repository('users');
const orders = db.repository('orders');

// Insert
await users.insert([{ id: 'u1', name: 'Alice' }, { id: 'u2', name: 'Bob' }]);

// Find with where, orderBy, limit, offset
const results = await users.find({
  where: { name: 'Alice' },
  orderBy: { column: 'name', direction: 'ASC' },
  limit: 10,
});

// Find one (returns null if not found)
const alice = await users.findOne({ id: 'u1' });

// Count
const total = await orders.count();
const pending = await orders.count({ status: 'pending' });

// Update
await orders.update({ where: { id: 'o1' }, set: { status: 'shipped' } });

// Delete
await orders.deleteRows({ status: 'cancelled' });

// Raw SQL at database level for joins and complex queries
const summary = await db.query(`
  SELECT u.name, SUM(o.total) AS revenue
  FROM users u JOIN orders o ON o.user_id = u.id
  GROUP BY u.id ORDER BY revenue DESC
`);

// Commit and metadata (database-level operations)
await db.commit();
const meta = await db.metadata();
```

See `examples/node/drive-db-repository-example.ts`.

TypeORM Driver (`diskd.os.datasource()`)
-------------------------------------

Use TypeORM entities, relations, and repositories against Drive DB. SQL is routed
through Drive DB JSON-RPC, and TypeORM's transaction lifecycle maps to Drive DB's
commit/rollback semantics. Requires `typeorm` as a peer dependency.

### Installation

```bash
npm install @diskd/sdk typeorm
```

### Usage

```ts
import { diskd } from '@diskd/sdk';
import { Entity, PrimaryColumn, Column } from 'typeorm';

// Define entities
@Entity({ name: 'users' })
class User {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'varchar' })
  email!: string;
}

// Create DataSource backed by Drive DB
process.env.APIS_BASE_URL ??= 'https://apis.diskd.local:8080';

const auth = diskd.auth.apiKey({ workspaceId: 'workspace-123' });

const ds = diskd.os.datasource({
  auth,
  url: `${process.env.APIS_BASE_URL}/v1/os/database/api/v1`,
  dbName: 'shop.workspace-123.main',
  entities: [User],
  synchronize: true,
});

await ds.initialize();

// Standard TypeORM repository operations
const userRepo = ds.getRepository(User);
await userRepo.save({ id: 'u1', name: 'Alice', email: 'alice@example.com' });

const alice = await userRepo.findOneBy({ id: 'u1' });
const users = await userRepo.find({ order: { name: 'ASC' } });

// Persist to S3 (flush WAL)
await ds.driver.commit();

// Rollback discards uncommitted changes (revert to last commit)
await ds.driver.driveRollback();
```

### Transaction mapping

| TypeORM operation       | Drive DB action                        |
|------------------------|----------------------------------------|
| `BEGIN TRANSACTION`    | No-op (writes auto-accumulate in WAL)  |
| `COMMIT`               | `drive.db.commit()` -- flush WAL to S3 |
| `ROLLBACK`             | `drive.db.rollback()` -- discard WAL   |

### Limitations (v1)

- No nested transactions / savepoints (deferred to v2)
- Affected row count returns 0 (each JSON-RPC call is a separate SQLite
  connection; works fine for ULID-based entities)
- Schema introspection from live database is limited; `synchronize: true`
  generates DDL directly

See `examples/node/typeorm-drive-example.ts` and `docs/typeorm-driver-design.md`.

LLM Router API
--------------

JSON-RPC 2.0 + NDJSON streaming for multi-provider LLM completions:

```ts
const llm = diskd.os.llm({ auth });

// Non-streaming completion
const result = await llm.completions.create({
  provider: 'openai', model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Hello' }],
  maxTokens: 64,
});

// Streaming
for await (const chunk of llm.completions.stream(params)) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
}

// Models, embeddings, OCR, audio transcription
const models = await llm.models.listAll();
const embeddings = await llm.embeddings.create({ provider: 'openai', model: 'text-embedding-3-small', input: ['text'] });
```

See `examples/node/llm-router-example.ts`.

Agent Hub API
-------------

SSE streaming with `StreamProtocolHandler` + `StreamProtocolFetcher` for agent invocation:

```ts
import { diskd, StreamProtocolHandler } from '@diskd/sdk';

const agents = diskd.os.agents({ auth, workspaceId: '...' });

// List agents and models
const agentList = await agents.agents.list();
const models = await agents.agents.getSupportedModels('assistant');
const billing = await agents.billing.getAliases();

// Invoke with fluent stream handling
const handler = new StreamProtocolHandler()
  .on('response.output_text.delta', (e) => process.stdout.write(e.delta))
  .on('response.completed', (e) => console.log('done', e.response.usage))
  .on('response.failed', (e) => console.error(e.response.error.message))
  .on('error', (e) => console.error(e.message));

const stream = await agents.invoke({
  agentName: 'assistant',
  query: 'Hello',
  agentOptions: { maxTokens: 256 },
});

stream.map((event) => handler.handle(event))
  .stop(() => console.log('stream closed'))
  .catch((err) => console.error(err));
```

Stream protocol events include text deltas, function calls/results, content parts
(images, files, audio), web/file search lifecycle, external sources, plan updates,
notifications, and error/completion signals.

See `examples/node/agent-hub-example.ts`.

MCP Hub API
-----------

REST client for MCP server catalog, registry, and integrations:

```ts
const mcp = diskd.os.mcp({ auth, workspaceId: '...' });

// Catalog
const catalog = await mcp.catalog.list({ search: 'github' });
const details = await mcp.catalog.getServerDetails(serverId);

// Registry (installed servers)
const registry = await mcp.registry.list();
const added = await mcp.registry.addServer({ catalogServerId: '...' });
await mcp.registry.toggleTool(serverId, toolId, false);
const logs = await mcp.registry.getServerLogs(serverId, { limit: 10 });
await mcp.registry.deleteServer(serverId);

// Env vars, connection settings, remote servers
await mcp.registry.upsertEnvVar(serverId, { key: 'TOKEN', value: '...' });
await mcp.registry.addRemoteServer({ name: 'My MCP', url: '...', authType: 'pat' });
```

See `examples/node/mcp-hub-example.ts`.

Telegram Userbot API
--------------------

REST client for Telegram channel resolution, importing, and message retrieval:

```ts
const tg = diskd.utils.tgUserBot({ auth, workspaceId: '...' });

// Resolve channel (public, no auth required)
const resolved = await tg.channels.resolve('durov');

// Channel operations
const channels = await tg.channels.list();
await tg.channels.add({ channelIdentifier: '@mychannel', limit: 1000 });
await tg.channels.sync({ telegramId: -1001234567890 });

// Messages and stats
const messages = await tg.channels.getMessages(channelId, { limit: 50, searchText: 'keyword' });
const stats = await tg.channels.getStats(channelId);
const status = await tg.channels.getStatus(channelId);

// Tasks
const tasks = await tg.tasks.list();
await tg.tasks.cancel(taskUuid);
```

See `examples/node/tg-userbot-example.ts`.

Web Navigator API
-----------------

REST client for URL resolution and web scraping jobs:

```ts
const webNav = diskd.utils.webNavigator({ auth, workspaceId: '...' });

// Resolve URL metadata
const meta = await webNav.resolve({ url: 'https://example.com' });

// Submit scrape job
const job = await webNav.scrape.submit({ url: 'https://example.com', depth: 1, maxPages: 10 });
const status = await webNav.scrape.getStatus(job.jobId);
const result = await webNav.scrape.getResult(job.jobId);
await webNav.scrape.cancel(job.jobId);
```

See `examples/node/web-navigator-example.ts`.

Web quickstart (Vite + PKCE)
----------------------------

Use `@diskd/sdk/browser` and a standard OAuth2 Authorization Code + PKCE redirect.

Runnable example: `examples/web/` (see `examples/README.md`).

Publishing a new version
------------------------

1. Bump the version in `package.json`:

   ```bash
   npm version patch   # 0.3.0 -> 0.3.1
   npm version minor   # 0.3.0 -> 0.4.0
   npm version major   # 0.3.0 -> 1.0.0
   ```

2. Push the commit and tag:

   ```bash
   git push gitlab main --tags
   ```

3. The GitLab CI pipeline triggers on `v*.*.*` tags and automatically:
   - Builds the project
   - Runs unit tests and typecheck
   - Publishes to the GitLab Package Registry

4. Verify at: `https://gitlab.iosya.com/upgraide-v2/platform-api/-/packages`

Docs and examples
-----------------

- Quickstart: `docs/sdk-quickstart.md`
- Examples: `examples/README.md`
- Design: `docs/drive-session-sdk-design.md`
