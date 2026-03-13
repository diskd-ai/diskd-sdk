App-service Subtask: Profile Tab "API Credentials Keys" + Download credentials.json
=================================================================================

Status: ready for implementation (minimal v1)
Parent: Redmine #1537 (Preliminary SDK)
Related: Redmine #1538 (SDK MVP: createAuth + drive.init + drive.list)
Last updated: 2026-02-07

Context and motivation
----------------------

The SDK MVP in #1538 requires a Google-style `createAuth({ scopes, keyfilePath })` flow for non-interactive API usage.
End users need a simple, discoverable way to obtain a `credentials.json` file that can be used by the SDK without going through an interactive login flow.

Goals
-----

- Add a new tab to the user profile page (`app.upgraide.dev` → Settings/Profile):
  - Tab label: `API Credentials Keys`
  - Primary action: download `credentials.json`
- Ensure the downloaded file format matches the SDK expectation (#1538 keyfile format).

Non-goals for this minimal version
----------------------------------

- No UI for rotating/revoking keys.
- No multiple keys management.
- No showing secrets on screen (download-only is sufficient).
- No detailed error handling UX (use default toasts/errors already used in Settings pages).

Implementation considerations
-----------------------------

- Access control: only an authenticated user can download their own credentials file.
- Security:
  - Do not log the credentials content server-side.
  - Ensure `Content-Disposition: attachment; filename="credentials.json"`.
- Source of truth for secrets:
  - Best-effort assumption: credentials are backed by IAM/OAuth2 (Hydra) confidential clients and are per-user/per-workspace.
  - If the IAM/OAuth2 layer cannot provide per-user clients yet, introduce a minimal internal endpoint in IAM to create/retrieve them, then have app-service call it.

High-level behavior
-------------------

1. User opens `app.upgraide.dev` and navigates to Settings/Profile.
2. User opens the `API Credentials Keys` tab.
3. User clicks `Download credentials.json`.
4. Browser downloads a JSON file.

API design
----------

### Backend endpoint (app-service)

- `GET /api/sdk/credentials.json`
  - Auth: session cookie (same as other app-service API endpoints)
  - Response: JSON file download

### File format

Return JSON compatible with SDK #1538:

```json
{
  "issuer": "https://oauth2.upgraide.dev:8080",
  "clientId": "<workspace-or-user-derived-client-id>",
  "clientSecret": "<secret>",
  "audience": "diskd-api"
}
```

Notes:

- `issuer` should match the environment (local/staging/prod).
- `clientId` should be derived from the current user/workspace in a stable way.

Future-proofing
---------------

- Add “rotate secret” and “revoke” actions.
- Support multiple credentials with labels and last-used timestamps.

Implementation outline
----------------------

1. Web:
   - Add a new tab item in `web/src/settings-module/pages/SettingsPage.tsx`.
   - Add a small component for the tab content with a single download button.
2. Backend:
   - Add `GET /api/sdk/credentials.json` route that returns the file for the current session user.
   - Wire credentials retrieval/creation to IAM/OAuth2 layer (minimal internal integration).

Testing approach
----------------

- Manual:
  - Open Settings/Profile and verify the new tab exists.
  - Click download and confirm the browser downloads `credentials.json`.
  - Validate the JSON parses and contains required fields.

Acceptance criteria
-------------------

- In `app.upgraide.dev` user profile, a tab named `API Credentials Keys` exists.
- Clicking the download action returns `credentials.json` with the required fields (`issuer`, `clientId`, `clientSecret`, `audience`).
- The downloaded `credentials.json` is compatible with `createAuth({ scopes, keyfilePath })` from #1538.
