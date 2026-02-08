# @diskd/sdk (MVP)

Minimal Google-style SDK for DiskD APIs.

- Node (non-interactive): `createAuth({ scopes, keyfilePath })`
- Web (interactive): `createAuth({ issuer, clientId, redirectUri, scopes, audience })` + PKCE redirect flow

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
- Default: `https://apis.diskd.local:8080`

Local TLS note (dev only):

`*.diskd.local` uses a local/self-signed cert in dev. For Node examples you may need either:

- trust the local CA/cert, or
- run with `NODE_TLS_REJECT_UNAUTHORIZED=0` (local-only).

Node quickstart (credentials.json)
----------------------------------

1) Download `credentials.json` from `https://app.diskd.local` → Settings/Profile → `API Credentials Keys`.

2) Run:

```bash
export DISKD_BASE_URL='https://apis.diskd.local:8080'
node -e "console.log(process.env.DISKD_BASE_URL)"
```

```ts
import path from 'node:path';
import { createAuth, diskd } from '@diskd/sdk';

const auth = await createAuth({
  scopes: ['openid'],
  keyfilePath: path.resolve(process.cwd(), 'credentials.json'),
});

const drive = diskd.drive({ version: 'v1', auth });
await drive.init();
const entries = await drive.list({ path: '/' });
console.log(entries);
```

Web quickstart (Vite + PKCE)
----------------------------

Use `@diskd/sdk/browser` and a standard OAuth2 Authorization Code + PKCE redirect.

Runnable example: `examples/web/` (see `examples/README.md`).

Docs & examples
---------------

- Quickstart: `docs/sdk-quickstart.md`
- Examples: `examples/README.md`
- Task docs: `docs/1537-*.md`, `docs/1538-*.md`
