# LOG

## 2026-08-05

- `enabling:dev/platform-api/sdk/inbox`: made mailbox-wide Inbox search collapse repeated folder projections by normalized RFC message ID and order the unique envelopes globally by received time before applying the caller limit. Motivation: one stored email can appear through Inbox, All Mail, Important, or Spam projections, which made parallel mail digests duplicate messages and lose newest-first order (Redmine 3056).
- `enabling:dev/platform-api/sdk/inbox`: limited connected Inbox account discovery to Exchange-ingested mailboxes, leaving Drive-owned system mailboxes such as Review accessible only through their dedicated typed APIs. Motivation: prevent parallel mail search workers from treating the Review queue as a connected email account and deterministically retrying a nonexistent remapped mailbox.

## 2026-08-04

- `enabling:dev/platform-api/sdk/inbox`: added a typed `stored-only` Inbox content mode that reads exclusively from Drive messageboxes, rejects content not yet persisted by ingestion, and cannot be configured with Email MCP. Motivation: parallel Messages workers must remain independent from the Email MCP ingestion process.

## 2026-08-02

- `enabling:dev/platform-api/sdk/messages-store`: exposed Drive's cursor-paginated sender aggregation as `mailbox.listSenders`, including mailbox-wide totals and opaque continuation cursors. Motivation: app-service must import every sender from large mailboxes without reading message bodies or relying on a private JSON-RPC fallback (Redmine 3021).
- `enabling:dev/platform-api/sdk/inbox`: moved inbox search execution to the bounded Drive `messages_store/search` contract and followed Drive cursors automatically until the caller's result limit or folder end, with a caller-selectable scan `pageSize` from 1 to 100 and a default of 20. Motivation: Redmine 2912 search must scale to thousands of stored messages without one SDK read per candidate.
