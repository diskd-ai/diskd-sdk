# @diskd/sdk

Unified TypeScript SDK for the Upgraide platform APIs.

All services are accessible via the `diskd` factory, which provides a consistent
`createApiKeyAuth` / `createAuth` + `diskd.<service>()` pattern:

```ts
import { createApiKeyAuth, diskd } from '@diskd/sdk';

const auth = createApiKeyAuth({ apiKey: '...', workspaceId: '...' });

const drive      = diskd.drive({ version: 'v1', auth });
const llm        = diskd.llm({ auth });
const agentHub   = diskd.agentHub({ auth, workspaceId: '...' });
const mcpHub     = diskd.mcpHub({ auth, workspaceId: '...' });
const tg         = diskd.tgUserbot({ auth, workspaceId: '...' });
const webNav     = diskd.webNavigator({ auth, workspaceId: '...' });
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
   npm install @diskd/sdk
   ```

Install / build (repo)
----------------------

```bash
cd mono/platform-api
npm install
npm run build
```

Authentication
--------------

The SDK supports two authentication modes via the `AuthModule` interface.

### External clients (OAuth2)

Use `createAuth` for OAuth2 service-account or PKCE browser flows:

```ts
import { createAuth, diskd } from '@diskd/sdk';

const auth = await createAuth({
  scopes: ['openid'],
  keyfilePath: 'credentials.json',
});

const drive = diskd.drive({ version: 'v1', auth });
```

### Internal services (API key)

Use `createApiKeyAuth` for service-to-service communication within the cluster:

```ts
import { createApiKeyAuth, diskd } from '@diskd/sdk';

const auth = createApiKeyAuth({
  apiKey: process.env.DRIVE_API_KEY!,
  workspaceId: process.env.WORKSPACE_ID!,
});

const drive = diskd.drive({
  version: 'v1',
  auth,
  url: 'http://drive-service:8000/drive/api/v1',
});
```

Both auth modes produce identical client instances.

Environment variables
---------------------

Each service resolves its base URL from an environment variable, falling back
to an in-cluster K8s service name:

| Service        | Env Variable             | Default                        |
|----------------|--------------------------|--------------------------------|
| Drive          | `DISKD_BASE_URL`         | `https://apis.upgraide.dev:8080` |
| LLM Router     | `LLM_ROUTER_BASE_URL`   | `http://llm-router:3000`      |
| Agent Hub      | `AGENT_HUB_BASE_URL`    | `http://agent-hub:8081`       |
| MCP Hub        | `MCP_HUB_BASE_URL`      | `http://mcp-hub:8300`         |
| TG Userbot     | `TG_USERBOT_BASE_URL`   | `http://tg-userbot:8000`      |
| Web Navigator  | `WEB_NAVIGATOR_BASE_URL` | `http://web-navigator:8080`  |

All can be overridden per-client via the `url` parameter.

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

### File metadata, disk usage, tools, sessions

```ts
const meta = await drive.files.metadata({ inode: 'abc' });
const usage = await drive.diskUsage();
const ls = await drive.tools.ls({ path: '/', recursive: true });
const grep = await drive.tools.grep({ pattern: 'TODO' });
```

See `examples/node/drive-upload-download.ts` and `examples/node/drive-session-external.ts`.

LLM Router API
--------------

JSON-RPC 2.0 + NDJSON streaming for multi-provider LLM completions:

```ts
const llm = diskd.llm({ auth, url: 'http://llm-router:3000' });

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

const agentHub = diskd.agentHub({ auth, workspaceId: '...' });

// List agents and models
const agents = await agentHub.agents.list();
const models = await agentHub.agents.getSupportedModels('assistant');
const billing = await agentHub.billing.getAliases();

// Invoke with fluent stream handling
const handler = new StreamProtocolHandler()
  .on('response.output_text.delta', (e) => process.stdout.write(e.delta))
  .on('response.completed', (e) => console.log('done', e.response.usage))
  .on('response.failed', (e) => console.error(e.response.error.message))
  .on('error', (e) => console.error(e.message));

const stream = await agentHub.invoke({
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
const mcpHub = diskd.mcpHub({ auth, workspaceId: '...' });

// Catalog
const catalog = await mcpHub.catalog.list({ search: 'github' });
const details = await mcpHub.catalog.getServerDetails(serverId);

// Registry (installed servers)
const registry = await mcpHub.registry.list();
const added = await mcpHub.registry.addServer({ catalogServerId: '...' });
await mcpHub.registry.toggleTool(serverId, toolId, false);
const logs = await mcpHub.registry.getServerLogs(serverId, { limit: 10 });
await mcpHub.registry.deleteServer(serverId);

// Env vars, connection settings, remote servers
await mcpHub.registry.upsertEnvVar(serverId, { key: 'TOKEN', value: '...' });
await mcpHub.registry.addRemoteServer({ name: 'My MCP', url: '...', authType: 'pat' });
```

See `examples/node/mcp-hub-example.ts`.

Telegram Userbot API
--------------------

REST client for Telegram channel resolution, importing, and message retrieval:

```ts
const tg = diskd.tgUserbot({ auth, workspaceId: '...' });

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
const webNav = diskd.webNavigator({ auth, workspaceId: '...' });

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
