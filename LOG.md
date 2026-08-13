# LOG

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
