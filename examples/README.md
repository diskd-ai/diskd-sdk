# SDK Examples

This folder contains runnable examples for `@diskd-ai/sdk`.

Prereqs
-------

- Node.js 22+
- `npm install` in the repo root (`mono/platform-api`)

Build once
----------

```bash
cd mono/platform-api
npm run build
```

Smoke test (real DiskD required)
--------------------------------

Runs the Node quickstart against a real DiskD environment (local Tilt overlay is fine).

```bash
cd mono/platform-api
export APIS_BASE_URL='https://apis.upgraide.dev:8080'
export DISKD_CREDENTIALS_PATH='/absolute/path/to/credentials.json'
npm run examples:smoke
```

Node quickstart (real DiskD + real `credentials.json`)
------------------------------------------------------

1. In `app.upgraide.dev`, open **Profile** -> **API Credentials Keys** and download `credentials.json`.
2. Set Drive API base URL via env:

```bash
export APIS_BASE_URL='https://apis.upgraide.dev:8080'
```

Local TLS note (dev only):

`*.upgraide.dev` uses a local/self-signed cert in dev. For Node you may need either:

- trust the local CA/cert, or
- run with `NODE_TLS_REJECT_UNAUTHORIZED=0` (local-only).

3. Run:

```bash
cd mono/platform-api
npm run examples:node -- /absolute/path/to/credentials.json
```

Notes:

- If you omit the argument, the script uses `./credentials.json` in the current directory.
- You can also set `DISKD_CREDENTIALS_PATH` instead of passing a CLI arg.

Drive crontab example
---------------------

See `examples/node/drive-crontab.ts` for a project-scoped `diskd.platform.crontab()`
`createJob/get/getStatus/listJobs` flow using `diskd.auth.credentials(...)`.

Drive session examples
----------------------

See `examples/node/drive-session-external.ts` and
`examples/node/drive-session-internal.ts` for `diskd.platform.sessions()` flows with
project scope bound in the constructor.

Messages Store Review example
-----------------------------

See `examples/node/messages-store-review-example.ts` for a singleton Review box
flow using `diskd.os.messagesStore({ auth }).review.create/list/get/delete`.
By default it reads `.agents/credentials-dev.json` and uses the `apisUrl` from
that keyfile.

Run it against the dev APIS gateway:

```bash
bun run build
NODE_TLS_REJECT_UNAUTHORIZED=0 bun examples/node/messages-store-review-example.ts
```

Web quickstart (Vite, real OAuth client)
----------------------------------------

1. Build the SDK:

```bash
cd mono/platform-api
npm run build
```

2. Create `examples/web/.env.local`:

```bash
VITE_DISKD_CLIENT_ID='<YOUR_CLIENT_ID>'
VITE_DISKD_OIDC_ISSUER='https://oauth2.upgraide.dev:8080'
VITE_DISKD_AUDIENCE='diskd-api'
VITE_APIS_BASE_URL='https://apis.upgraide.dev:8080'
```

3. Install + run Vite:

```bash
cd mono/platform-api/examples/web
npm install
npm run dev
```

4. Open:

- the URL printed by Vite (usually `http://localhost:5173/`)

5. Click **Authorize** to start the OAuth redirect flow.
