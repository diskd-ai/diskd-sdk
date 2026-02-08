# DiskD SDK Quickstart (MVP)

This SDK follows a Google-style shape:

- `const auth = await createAuth(...)`
- `const drive = diskd.drive({ version: 'v1', auth })`

Drive base URL is configured via `DISKD_BASE_URL`:

- Node: `process.env.DISKD_BASE_URL`
- Browser: `globalThis.DISKD_BASE_URL` (e.g. `window.DISKD_BASE_URL`)

Node (3rd-party scripts with `credentials.json`)
------------------------------------------------

Prereqs:

- Node.js 22+
- `DISKD_BASE_URL` is set (example local overlay: `https://apis.diskd.local:8080`)
- `credentials.json` downloaded from `app.diskd.local` -> Profile -> `API Credentials Keys`

```ts
import path from 'node:path';
import { createAuth, diskd } from '@diskd/sdk';

const SCOPES = ['openid'];
const CREDENTIALS_PATH = path.resolve(process.cwd(), 'credentials.json');

const auth = await createAuth({
  scopes: SCOPES,
  keyfilePath: CREDENTIALS_PATH,
});

const drive = diskd.drive({ version: 'v1', auth });
await drive.init();

const entries = await drive.list({ path: '/' });
console.log(entries);
```

Web (PKCE OAuth redirect flow)
-----------------------------

Prereqs:

- An OAuth client configured in DiskD IAM/Hudra
- `DISKD_BASE_URL` injected into the page (example local overlay: `https://apis.diskd.local:8080`)

In a bundler (Vite/Webpack/etc):

```ts
import { createAuth, diskd } from '@diskd/sdk/browser';

const auth = await createAuth({
  issuer: 'https://oauth2.diskd.local:8080',
  clientId: '<YOUR_CLIENT_ID>',
  redirectUri: window.location.origin + window.location.pathname,
  scopes: ['openid'],
  audience: 'diskd-api',
});

const drive = diskd.drive({ version: 'v1', auth });

await auth.handleRedirectCallback();

// On button click:
// await auth.signIn(); // redirects to OAuth

if (auth.getToken()) {
  await drive.init();
  const entries = await drive.list({ path: '/' });
  console.log(entries);
}
```

Runnable examples in this repo
------------------------------

- Node quickstart: `examples/node/quickstart.ts`
- Web quickstart (Vite): `examples/web/`
- Smoke test (real DiskD): `npm run examples:smoke`
