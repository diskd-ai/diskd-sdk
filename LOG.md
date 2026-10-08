# LOG

## 2026-10-07

- `BUG enabling:dev/platform-api/drive` (782c4a6, Redmine #3186) -- `drive.tools.inodesQuery` sends `fileOffset` and `fileLimit` and returns `total`, `nextOffset` and typed `warnings`; an older Drive decodes to null, null and no warnings. Released in SDK 7.4.0 (consent 2026-10-08).
- `TASK enabling:dev/platform-api/inbox` -- Exchange flag colours (SDK 7.3.0).
  `PLATFORM_FLAG_COLORS` (red, orange, yellow, green, blue, purple, gray),
  `PlatformFlagColor` and `platformColorFlag(color)` (`color:<name>`) are
  exported. `inbox.setFlagged({..., flagged: true, color})` writes the colour
  flag (Drive adds `flagged` and keeps one colour); a colour with
  `flagged: false` is rejected. `StoredEmail` and `InboxEmailEnvelope` gain
  `flagColor`: the stored colour, red for a flag without one, null when not
  flagged. Why: operatives flag mail in colour through `messages__flag`, like
  the Exchange app.

## 2026-10-05

- `TASK enabling:dev/platform-api/messagesStore` + `inbox` -- platform-owned
  flags and labels on Exchange mailbox messages (Redmine #3143 G1/G2).
  `StoredMessage` gains `platformFlags`, `platformLabels` and
  `platformRevision` (absent on older Drive builds, decoded as empty / 0).
  `folder.setAttributes({externalId, flagsAdd, flagsRemove, labelsAdd,
  labelsRemove})` calls Drive `messages_store/set-attributes`;
  `PLATFORM_FLAGGED` is the v1 flag. The inbox client adds
  `setFlagged` and `setLabels`, which write Drive only (the IMAP worker
  mirrors the star from Drive's `exchange.message.flagged/unflagged`
  event), and `StoredEmail` now reports `isFlagged` as provider
  `\Flagged` or the platform star, `labels` as provider plus platform
  labels, and `platformLabels` as the removable ones. Motivation: the IMAP
  worker rewrites provider flags/labels on every sync, so operatives and the
  Exchange UI need their own state on the Drive entity.
  Verification: messagePlatformAttributes, inboxClient and
  messagesStoreClient node tests (61) pass; typecheck and biome clean.
- `TASK enabling:dev/platform-api/agentHub` -- marked the Agent Hub client
  `@deprecated` in TSDoc (`createAgentHubClient`, `diskd.os.agents`,
  `AgentHubClient` and its package-exported types) and flagged it as
  deprecated and unrouted in README and AGENTS.md. Removed
  `scripts/validate-agents-external.ts`, its tracked compiled copy in
  `dist-scripts/`, and the `scripts:agents-external` package script.
  Motivation: apis-service declares no `/v1/os/agents` route and agent-hub is
  deprecated; agent turns run on pi-agent-service through the app-service
  sessions API, so the external validation could never pass through the
  gateway. Exports kept, no version bump (no breaking change).
- `TASK enabling:dev/platform-api/sdk` -- examples and README now request the
  gateway route scopes each client calls (`drive:*`, `sessions:*`,
  `crontab:*`, `calendar:*`, `contacts:*`) instead of only `openid`, and the
  README maps every `diskd.*` client to its route scopes. Motivation: prepare
  callers for apis-service scope enforcement; the gateway currently only logs
  `token_scopes`/`scopes_satisfied`. No SDK code or version change.
- `TASK enabling:dev/platform-api/sdk` -- the OAuth2 validation scripts and the
  keyfile Drive smoke test now request their route scopes too:
  `validate-drive-external` and `drive.keyfile.smoke.test` ask for
  `drive:read drive:write`, `validate-llm-external` for
  `llm:invoke llm:models:read`. `validate-agents-external` stays `openid`-only
  because apis-service has no `/v1/os/agents` route. Motivation: keep the
  validation paths passing once apis-service enforces route scopes. No SDK code
  or version change.

## 2026-10-04

- `BUG enabling:dev/platform-api/drive` -- expose stateless preview/range reads with canonical message selectors so callers can page parent conversations and selected child journals without retaining full session objects. Omitted selectors preserve existing reads. Session client/object tests and the SDK build pass.

## 2026-09-15

- `enabling:dev/platform-api/inbox`: route mark-read through the existing email
  attribute adapter and require both provider flags and fresh persisted Drive
  state. The browser previously saw unread while the tool claimed success
  because the SDK only wrote a legacy boolean. Keep provider flags authoritative
  in projections and reject mutation on stored-only clients. Seven regressions
  fail before correction; all 54 affected Inbox client/query tests pass. Release
  and deployed browser acceptance remain pending.

## 2026-08-30

- `enabling:dev/platform-api/sdk/messages-store`: exposed revision-guarded
  deletion of terminal Sent and Failed Exchange items through the canonical
  typed SDK. Motivation: app-service must remove completed Review history
  through Drive's owner contract without duplicating JSON-RPC wire shapes or
  weakening lifecycle protection.

## 2026-08-29

- `enabling:dev/platform-api/sdk/messages-store`: added a non-empty outbound
  email attachment variant using canonical Drive paths, filenames, and content
  types. Motivation: provider adapters must hydrate attachment artifacts through
  the Drive SDK without embedding bytes, provider DTOs, or storage identifiers
  in Exchange events.

- `enabling:dev/platform-api/sdk/drive`: routed determinate-length stream uploads
  through the installed Undici transport and added a large multi-chunk Bun
  regression to the release gate. Motivation: Bun's Node HTTP compatibility
  transport replaced `Content-Length` with chunked transfer encoding under
  proxy backpressure, causing Drive to reject valid uploads with HTTP 411.

- `enabling:dev/platform-api/sdk/drive`: preserved the declared byte length on
  streaming `upload.file` requests with a Node-compatible transport, including
  under Bun, and removed the redundant transfer-only operation. Motivation:
  the SDK must own the complete Drive upload lifecycle while allowing Drive to
  validate and stream a determinate-length body.

- `enabling:dev/platform-api/sdk/messages-store`: exposed atomic Review
  approval plus Outbox get, pending listing, claim, lease renewal, and explicit
  Sent/Failed terminal writes through one canonical `ExchangeItem` contract.
  Motivation: platform callers and provider adapters should use the released
  typed Drive storage boundary without duplicating JSON-RPC wire shapes or
  provider-delivery policy.

## 2026-08-28

- `enabling:dev/platform-api/sdk/messages-store`: exposed one canonical outbound
  Exchange item through account-required Review and Outbox creation plus a
  generic revision-guarded lifecycle update. Motivation: producers and provider
  adapters need a typed Drive storage contract without embedding delivery or
  retry policy in the SDK.

## 2026-08-13

- `enabling:dev/platform-api/sdk/inbox`: preserve a double-quoted free-text
  phrase as one literal criterion and retain its quotes when forwarding the
  query to Drive. Motivation: Redmine 3088 copied `"Your rank: #1"` from the
  selected email, but SDK validation split the phrase and rejected `rank:` as
  an unsupported operator before the quote-safe Drive provider was called.

- `enabling:dev/platform-api/sdk/inbox`: forward oldest/newest search order to
  Drive and stop each folder after it yields enough ordered distinct
  candidates, then merge and limit globally before any message body is read.
  Motivation: Redmine 3088 needs three oldest distinct senders, but the SDK
  previously scanned every matching page in every folder before selecting
  three envelopes for the single-message evidence phase.

## 2026-08-10

- `enabling:dev/platform-api/sdk/inbox`: added typed `folder:` and `recursive:` query criteria, with recursive search enabled by default, exact path before unique display-name resolution, provider-delimiter descendant boundaries, and explicit missing or ambiguous folder errors. Folder routing is removed before Drive message search, while folder-only queries use the existing ordered Messages Store listing. Motivation: Redmine 2910 must search one mail folder tree without adding a parallel selector parameter or matching prefix siblings such as `Aix2`.

## 2026-08-09

- `enabling:dev/platform-api/sdk/drive`: decode indexed document parts with the reusable document-level origin when Drive provides one, instead of exposing converter-temporary part paths. Motivation: Redmine 3074 search results must remain readable through an operative chroot after indexing.
- `enabling:dev/platform-api/sdk/inbox`: modelled connected mailbox identity as an explicit searchable or unavailable variant and exposed the caller-owned email metadata separately from the executable account selector and human display name. Motivation: Redmine 3066 mail coverage must never infer an email from a label or omit a connector whose legacy metadata is unavailable.
- `enabling:dev/platform-api/sdk/inbox`: exported the existing typed inbox query parser and stable error formatter from the SDK package root. Motivation: mail orchestrators must validate the exact Gmail-style query contract before creating deterministic or LLM-backed subprocesses without duplicating query grammar.

## 2026-08-05

- `enabling:dev/platform-api/sdk/inbox`: made mailbox-wide Inbox search collapse repeated folder projections by normalized RFC message ID and order the unique envelopes globally by received time before applying the caller limit. Motivation: one stored email can appear through Inbox, All Mail, Important, or Spam projections, which made parallel mail digests duplicate messages and lose newest-first order (Redmine 3056).
- `enabling:dev/platform-api/sdk/inbox`: limited connected Inbox account discovery to Exchange-ingested mailboxes, leaving Drive-owned system mailboxes such as Review accessible only through their dedicated typed APIs. Motivation: prevent parallel mail search workers from treating the Review queue as a connected email account and deterministically retrying a nonexistent remapped mailbox.

## 2026-08-04

- `enabling:dev/platform-api/sdk/inbox`: added a typed `stored-only` Inbox content mode that reads exclusively from Drive messageboxes, rejects content not yet persisted by ingestion, and cannot be configured with Email MCP. Motivation: parallel Messages workers must remain independent from the Email MCP ingestion process.

## 2026-08-02

- `enabling:dev/platform-api/sdk/messages-store`: exposed Drive's cursor-paginated sender aggregation as `mailbox.listSenders`, including mailbox-wide totals and opaque continuation cursors. Motivation: app-service must import every sender from large mailboxes without reading message bodies or relying on a private JSON-RPC fallback (Redmine 3021).
- `enabling:dev/platform-api/sdk/inbox`: moved inbox search execution to the bounded Drive `messages_store/search` contract and followed Drive cursors automatically until the caller's result limit or folder end, with a caller-selectable scan `pageSize` from 1 to 100 and a default of 20. Motivation: Redmine 2912 search must scale to thousands of stored messages without one SDK read per candidate.

## 2026-10-03

- `enabling:dev/platform-api/email`: add `diskd.os.email` for durable shared-worker
  commands. Move Inbox hydration and read/unread operations to this client,
  preserving canonical Drive content and provider confirmation. Remove MCP tool
  discovery and replace the Inbox custom `mcpUrl` option with `emailUrl`.
  Build and 58 focused SDK regressions pass on Bun and Node.
