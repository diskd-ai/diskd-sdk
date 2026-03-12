# @diskd/sdk (MVP)

Minimal Google-style SDK for DiskD APIs.

- Node (non-interactive): `createAuth({ scopes, keyfilePath })`
- Web (interactive): `createAuth({ issuer, clientId, redirectUri, scopes, audience })` + PKCE redirect flow
- Internal services: `createApiKeyAuth({ apiKey, workspaceId })`

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

Configuration
-------------

Drive API base URL is resolved from `DISKD_BASE_URL`:

- Node: `process.env.DISKD_BASE_URL`
- Browser: `window.DISKD_BASE_URL`
- Default: `https://apis.upgraide.dev:8080`

Local TLS note (dev only):

`*.upgraide.dev` uses a local/self-signed cert in dev. For Node examples you may need either:

- trust the local CA/cert, or
- run with `NODE_TLS_REJECT_UNAUTHORIZED=0` (local-only).

Authentication
--------------

The SDK supports two authentication modes via the `AuthModule` interface:

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

Both auth modes produce identical `DriveClient` instances -- the API surface is the same.

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

### Upload

**Buffer upload** -- single call with progress (handles SHA256, intent, PUT, commit):

```ts
const result = await drive.upload.file({
  name: 'hello.txt',
  data: new TextEncoder().encode('Hello, world!'),
  mimeType: 'text/plain',
  onProgress: (uploaded, total) => {
    console.log(`${uploaded}/${total} bytes`);
  },
});
console.log(`Uploaded: inode=${result.inode}, etag=${result.etag}`);
```

**Stream upload** -- for large files, pass a `ReadableStream` with pre-computed size and SHA256:

```ts
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';

const stream = Readable.toWeb(createReadStream('/path/to/large-file.bin')) as ReadableStream<Uint8Array>;
const result = await drive.upload.file({
  name: 'large-file.bin',
  stream,
  size: 1_000_000_000,
  sha256Root: 'precomputed-sha256-hex',
  onProgress: (uploaded, total) => console.log(`${uploaded}/${total}`),
});
```

**Low-level upload** (start + commit separately):

```ts
const intent = await drive.upload.start({
  name: 'file.bin',
  size: 1024,
  sha256Root: '...',
});
// PUT data to intent.uploadUrl...
const committed = await drive.upload.commit({
  intentId: intent.intentId,
  etag: '...',
});
```

### Download

Returns a `ReadableStream` -- files are not buffered into memory:

```ts
const file = await drive.download.file({
  inode: 'abc123',
  onProgress: (downloaded, total) => {
    console.log(`${downloaded}/${total} bytes`);
  },
});
console.log(`Size: ${file.size}, type: ${file.mimeType}`);

// Pipe to file (Node.js)
import { Writable } from 'node:stream';
import { createWriteStream } from 'node:fs';
const dest = Writable.toWeb(createWriteStream('/tmp/output.bin')) as WritableStream<Uint8Array>;
await file.stream.pipeTo(dest);

// Or collect into buffer if needed
const reader = file.stream.getReader();
const chunks: Uint8Array[] = [];
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  chunks.push(value);
}
```

### File metadata

```ts
const meta = await drive.files.metadata({ inode: 'abc' });
const batch = await drive.files.metadataBatch({ inodes: ['a', 'b'] });
const url = await drive.files.downloadUrl({ inode: 'abc' });
```

### Disk usage

```ts
const usage = await drive.diskUsage();
console.log(`Used: ${usage.used} bytes`);
```

### Tools (path-based queries)

```ts
const ls = await drive.tools.ls({ path: '/', recursive: true });
const glob = await drive.tools.glob({ pattern: '**/*.md' });
const grep = await drive.tools.grep({ pattern: 'TODO' });
const search = await drive.tools.vsearch({ query: 'deployment guide', topK: 5 });
```

### Sessions

```ts
const session = await drive.session.start({ projectId: 'my-project', title: 'Chat' });
await session.append([
  drive.session.message({ role: 'user', content: 'Hello' }),
  drive.session.message({ role: 'assistant', content: 'Hi there!' }),
]);

const opened = await drive.session.open({
  projectId: 'my-project',
  sessionId: session.sessionId,
  limit: 10,
});
console.log(opened.messages);

const list = await drive.session.list({ projectId: 'my-project' });
```

See `examples/node/drive-session-external.ts` for a complete session workflow example.

Web quickstart (Vite + PKCE)
----------------------------

Use `@diskd/sdk/browser` and a standard OAuth2 Authorization Code + PKCE redirect.

Runnable example: `examples/web/` (see `examples/README.md`).

Publishing a new version
------------------------

1. Bump the version in `package.json`:

   ```bash
   npm version patch   # 0.1.0 -> 0.1.1
   npm version minor   # 0.1.0 -> 0.2.0
   npm version major   # 0.1.0 -> 1.0.0
   ```

2. Push the commit and tag to both remotes:

   ```bash
   git push github main && git push gitlab main
   git push github --tags && git push gitlab --tags
   ```

3. The GitLab CI pipeline triggers on `v*.*.*` tags and automatically:
   - Builds the project
   - Runs unit tests and typecheck
   - Publishes to the GitLab Package Registry

4. Verify at: `https://gitlab.iosya.com/upgraide-v2/platform-api/-/packages`

Docs & examples
---------------

- Quickstart: `docs/sdk-quickstart.md`
- Examples: `examples/README.md`
- Design: `docs/drive-session-sdk-design.md`
- Task docs: `docs/1537-*.md`, `docs/1538-*.md`
