SDK Fast DNS for Local Overlay (.local) Design Doc
==================================================

Status: implemented (v1)
Last updated: 2026-02-08

Context and motivation
----------------------

The Node.js SDK examples (notably `examples/node/drive-tree.ts`) are too slow in local overlay because every request to `*.upgraide.dev` spends ~5 seconds in name resolution. The Drive Tree demo makes many sequential `drive/paths/list` calls, so the overall runtime becomes ~40 seconds for a depth-3 tree.

Goals:
- Make local overlay SDK requests fast (sub-second for the Drive Tree demo).
- Keep the fix opt-in/limited to local overlay (avoid changing behavior in real environments).
- Keep the approach simple and safe for third-party Node apps.

Non-goals for first implementation (v1)
---------------------------------------

- No changes to cluster DNS, domains, or local network configuration.
- No changes to API payloads or Drive backend behavior.
- No new retry/error model in the SDK (this is a performance-only change).
- No Windows-specific hosts-file support (v1 targets Unix-like dev envs with `/etc/hosts`).

Implementation considerations
-----------------------------

- The SDK uses Node’s `fetch` (Undici). Undici’s connector supports a custom `lookup(...)` function.
- The fix must be Node-only and must not affect the browser bundle.
- The fix is intentionally conservative:
  - Auto-enable only when `DISKD_BASE_URL` includes `.local`
  - And only when the base URL hostname exists in `/etc/hosts`
  - Allow explicit enable/disable via `DISKD_SDK_FAST_DNS`
- Avoid leaking secrets (no logging of tokens or credentials).

High-level behavior
-------------------

1. On Node import of `@diskd/sdk`, the SDK evaluates whether fast DNS should be enabled.
2. If enabled:
   - The SDK reads `/etc/hosts` and builds a map `hostname -> ip`.
   - The SDK installs an Undici global dispatcher (`setGlobalDispatcher`) with a connector `lookup(...)` that:
     - Returns the IP from `/etc/hosts` immediately for mapped hostnames.
     - Falls back to `dns.lookup(...)` for other hostnames.
3. All subsequent HTTP(S) requests made via Undici (including Node `fetch`) use this lookup behavior.

Measurements (domain-specific)
------------------------------

Environment: local overlay with `DISKD_BASE_URL=https://apis.upgraide.dev:8080`.

Drive Tree demo runtime:
- Fast DNS disabled (`DISKD_SDK_FAST_DNS=0`): `real 40.98s`
- Fast DNS enabled (`DISKD_SDK_FAST_DNS=1`): `real 0.83s`

Single request timing (illustrative):
- `curl -w '%{time_namelookup} %{time_total}\\n' https://apis.upgraide.dev:8080/drive/api/v1 ...` reports `time_namelookup ~5.0s`.
- `curl --resolve apis.upgraide.dev:8080:127.0.0.1 ...` reduces total time to ~0.06s (lookup ~0).

Root cause (domain-specific)
----------------------------

`.local` hostnames can trigger slow resolver paths (e.g., mDNS-related delays). In this environment, name lookup dominates request latency (~5s per request), making sequential calls unusably slow.

Configuration (domain-specific)
-------------------------------

- Base URL: `DISKD_BASE_URL` (default: `https://apis.upgraide.dev:8080`)
- Fast DNS toggle:
  - Disable: `DISKD_SDK_FAST_DNS=0` or `DISKD_SDK_FAST_DNS=false`
  - Enable: `DISKD_SDK_FAST_DNS=1` or `DISKD_SDK_FAST_DNS=true`
  - Auto-enable: when `DISKD_SDK_FAST_DNS` is unset and `DISKD_BASE_URL` contains `.local`

Error handling and UX
---------------------

- This is an internal SDK optimization; it does not expose a user-facing API surface.
- If any prerequisite is missing (invalid base URL, unreadable `/etc/hosts`, hostname not present), the SDK no-ops and the default resolver behavior remains.

Update cadence / Lifecycle
--------------------------

- Fast DNS is configured once at module import time.
- Changes to `/etc/hosts` require restarting the Node process to take effect.

Future-proofing
---------------

- If needed, extend hosts-file support for Windows (`C:\\Windows\\System32\\drivers\\etc\\hosts`).
- If global dispatcher changes become problematic for some consumers, support a non-global mode (per-client dispatcher) without changing the public SDK API.

Implementation outline
----------------------

1. Add `undici` dependency for typed access to `Agent` and `setGlobalDispatcher`.
2. Implement `src/node/fastDns.ts`:
   - Parse `/etc/hosts`
   - Create `lookup(...)` that prioritizes hosts-file mappings
   - Apply Undici global dispatcher when enabled
3. Import the Node-only setup from `src/index.ts`.
4. Validate using:
   - `npm test`
   - `npm run test:integration` (with local overlay env vars)
   - `npm run examples:tree` and a timed run with `DISKD_SDK_FAST_DNS=0/1`

Testing approach
----------------

- Unit tests: existing SDK unit tests continue to pass (`npm test`).
- Integration test: `src/__integration_tests__/drive.keyfile.smoke.test.ts` validates `drive.init` + `drive.list` against a real local overlay when env vars are set.
- Manual perf verification:
  - Time the Drive Tree demo with fast DNS toggled on/off and confirm the runtime improves by >10x.

Acceptance criteria
-------------------

- With `DISKD_SDK_FAST_DNS=1`, the Drive Tree demo completes in under 2 seconds in local overlay.
- With `DISKD_SDK_FAST_DNS=0`, the Drive Tree demo reproduces the slow behavior (tens of seconds) in the same environment.
- `npm test` passes.
- `npm run test:integration` passes when `DISKD_CREDENTIALS_PATH` and `DISKD_BASE_URL` are provided.
