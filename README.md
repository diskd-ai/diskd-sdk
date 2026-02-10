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
- Default: `https://apis.upgraide.dev:8080`

Local TLS note (dev only):

`*.upgraide.dev` uses a local/self-signed cert in dev. For Node examples you may need either:

- trust the local CA/cert, or
- run with `NODE_TLS_REJECT_UNAUTHORIZED=0` (local-only).

Node quickstart (credentials.json)
----------------------------------

1) Download `credentials.json` from `https://app.upgraide.dev` → Settings/Profile → `API Credentials Keys`.

2) Run:

```bash
export DISKD_BASE_URL='https://apis.upgraide.dev:8080'
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
- Task docs: `docs/1537-*.md`, `docs/1538-*.md`
