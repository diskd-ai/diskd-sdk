# Acceptance Scenario: Email-to-Project Pipeline

## Document Purpose

Acceptance scenario for verifying platform readiness for automatic incoming email processing, email-to-project classification, Trello card creation, Google Calendar event generation, and Excel report generation.

This document is used by:
- testers -- to verify delivery readiness
- managers -- for gap analysis and prioritization
- architects -- to assess integration maturity and plan implementation

---

## C4: Scenario Participants

### System Context (Level 1)

```
                        [External Systems]
                        /       |        \
                 [Gmail/IMAP] [Trello]  [Google Calendar]
                       |        |         |
                       v        v         v
               +-------------------------------+
               |    Upgraide Platform           |
               |                               |
               |  [User] --> [Web UI]          |
               +-------------------------------+
```

### Container Diagram (Level 2)

```
[User]
    |
    v
[App Service Web UI]  -- Studio: Operatives, Routines, Prompts, Skills
    |                     Mail App     (@mail operative     + inbox UI     + email-mcp sidecar)
    |                     Calendar App (@calendar operative + calendar UI  + gcal/outlook sidecar)
    |                     Drive App    (@drive operative    + file browser + native Drive)
    |
    v
[App Service Backend]  -- Routine Execution Engine, Projects, Sessions
    |         |
    |         +---> [Agent Hub]  -- LLM orchestration (upgraide-agent)
    |         |         |
    |         |         +---> [MCP Hub Runtime]  -- JSON-RPC proxy to MCP pods
    |         |         |         |
    |         |         |         +---> [email-mcp Pod]       47 tools, IMAP IDLE watcher
    |         |         |         |       +-- [Email Sidecar]   config.toml CRUD (planned)
    |         |         |         |
    |         |         |         +---> [Trello MCP Pod]      11 tools
    |         |         |         +---> [GCal MCP Pod]        6 tools
    |         |         |
    |         |         +---> [Drive Tools API]  -- grep, ls, upload
    |         |
    |         +---> [Drive Service]  -- /Projects, .session SQLite, crontab scheduler
    |
    +---> [NATS]  -- event bus (email.received, project.updated, ...)
              |
              +---> [Drive Crontab] subscribed to NATS subjects
                    creates one-shot HTTP jobs -> webhook
```

### Component Diagram: Email-to-Project Flow (Level 3)

```
+------------------+     +-------------------+     +------------------+
| Gmail/IMAP       | --> | email-mcp Pod     | --> | IMAP IDLE        |
| (external inbox) |     | (@codefuturist)   |     | Watcher          |
+------------------+     +-------------------+     +--------+---------+
                                                            |
                                                   webhook (on_new_email)
                                                            |
                                                            v
+------------------+     +-------------------+     +------------------+
| NATS             | <-- | NATS Bridge       | <-- | webhook endpoint |
| subject:         |     | (HTTP->NATS)      |     |                  |
| email.received   |     +-------------------+     +------------------+
+--------+---------+
         |
         v
+------------------+     +-------------------+
| Drive Crontab    | --> | HTTP webhook      |
| (subscriber)     |     | POST /api/webhooks|
| creates one-shot |     | /routines/{id}/   |
| HTTP job         |     | trigger           |
+------------------+     +--------+----------+
                                  |
                                  v
                         +-------------------+
                         | App Service:      |
                         | Routine Execution |
                         | Engine            |
                         +--------+----------+
                                  |
                    +-------------+-------------+
                    |                           |
                    v                           v
           +----------------+          +----------------+
           | Session        |          | Agent Hub      |
           | (.session on   |          | (upgraide-     |
           | Drive)         |          |  agent)        |
           +----------------+          +-------+--------+
                                               |
                              +-------+--------+--------+--------+
                              |       |        |        |        |
                              v       v        v        v        v
                         [email] [drive]  [trello] [gcal]  [excel]
                         list_   upload   create_  create_  generate
                         emails  to org/  card     event    + upload
                                 project_dir
```

### Data Flow Diagram

```
1. INCOMING EMAIL
   Gmail/Outlook/IMAP --> email-mcp (IMAP IDLE) --> webhook --> NATS(email.received)

2. ROUTINE TRIGGER
   NATS(email.received) --> Drive Crontab (subscriber) --> one-shot HTTP job
   --> POST /api/webhooks/routines/{id}/trigger {operativeSlug, projectSlug}

   [Alternatively for rhythm:]
   Drive Crontab (schedule) --> HTTP job on timer --> same webhook

3. SESSION CREATION
   App Service: RoutineExecutionService
   --> routine_run (runId=ULID, status=running)
   --> Session (.session SQLite on Drive) with RoutineExchange metadata
   --> AgentService.invoke(operative, toolPolicy, session)

4. AGENT PROCESSING (Agent Hub: upgraide-agent)

   4a. Get list of new emails:
       email__list_emails(account, folder=INBOX, unread_only=true)
       --> [{uid, from, subject, date}]

   4b. FOR EACH email -- iterative verification routine:

       4b.1  email__get_email(uid) --> {body, headers, attachments[]}

       4b.2  LLM classifies email:
             Project folder descriptions (description.md) loaded in operative context.
             Iteratively verifies: which project folder does it belong to?
             --> verdict: {project_dir, confidence, reasoning}
             low confidence -> /Projects/OrgName/.triage/inbox/, skip

       4b.3  drive__upload -> /Projects/OrgName/{project_dir}/inbox/{date}_{subject}.eml
             attachments -> /Projects/OrgName/{project_dir}/inbox/attachments/

       4b.4  trello__create_card(board_id, list_id, name, desc)
             --> {card_id, card_url}

       4b.5  gcal__create_event(calendar_id, summary, start, end, desc)
             --> {event_id, event_url}

       4b.6  Excel: generate/update intake.xlsx
             drive__upload -> /Projects/OrgName/{project_dir}/reports/intake.xlsx

       4b.7  Sender binding:
             drive__upload -> /Projects/OrgName/{project_dir}/.contacts/{hash}.json

       4b.8  email__mark_email(read=true) + email__add_label("Processed")

       --> next email, repeat 4b.1-4b.8

5. COMPLETION
   Session: messages flushed to Drive
   routine_run: status -> succeeded/failed
   routine.stats: totalRuns++, lastRunAt updated

6. OUTPUT DATA (per email, within project OrgName)
   /Projects/OrgName/{project_dir}/inbox/{file}.eml       -- email
   /Projects/OrgName/{project_dir}/inbox/attachments/*    -- attachments
   /Projects/OrgName/{project_dir}/.contacts/{hash}.json  -- sender binding
   /Projects/OrgName/{project_dir}/reports/intake.xlsx    -- registry (Excel import template)
   Trello card (board/list)                               -- card with description
   Google Calendar event                                  -- event with links
   Session (.session SQLite)                              -- full execution log
```

### Service Boundaries (Container level)

| Service | Role in Scenario | Current Status |
|---------|-----------------|----------------|
| **App Service** | Projects, operatives, routine execution engine, sessions | NestJS backend + React web. Routines -- in-memory seed, execution engine -- design only |
| **Drive** | /Projects/{name}/inbox, .session SQLite, crontab scheduler, XLSX processor | Working, JSON-RPC API. Crontab scheduler 95% ready, uses HTTP webhooks |
| **Agent Hub** | LLM orchestration, MCP tool invocation via tool policy | upgraide-agent working, tool policy framework ready |
| **MCP Hub** | MCP server catalog, runtime (K8s pods), Vault for secrets | Catalog + runtime working. Email, Trello, GCal servers in seed |
| **MCP Email Server** (`@codefuturist/email-mcp`) | IMAP/SMTP: 47 tools, multi-account (TOML config), IMAP IDLE watcher, AI triage presets, labels, scheduling, calendar extraction, analytics | In MCP Hub catalog |
| **MCP Server Trello** | create_card, update_card, list_boards, attach_file etc. | In MCP Hub catalog (11 tools) |
| **MCP Google Calendar** | create_event, update_event, list_events etc. | In MCP Hub catalog (6 tools, OAuth read-write) |
| **Calendar App** (platform) | Built-in platform calendar, syncs with Google Calendar and Outlook Calendar via MCP | Planned (analogous to Mail App) |
| **NATS** | Event bus for event-driven routine triggers | Planned (replacing RabbitMQ, which is deployed but unused) |

### Key Platform Entities

| Entity | Description | Status |
|--------|-------------|--------|
| **Operative** | AI agent profile: LLM provider/model, orders (prompt), equipment (skills + MCP tools), intel access, trust level | Implemented (entity + CRUD + UI) |
| **App Operative** | System operative for Dynamic App: `@mail`, `@calendar`, `@drive`. Equipment bound to MCP sidecar. Available globally | Pattern defined, implementation planned |
| **Routine** | Routine: triggerType (rhythm/signal), steps (action sequence), stats | Entity defined, service in-memory seed. CRUD on Drive -- design only |
| **routine_run** | Routine execution instance: runId, status, sessionId | Type `ParticipantKind = 'routine_run'` defined in session types. Table `routine_execution_runs` -- design only |
| **Session** | Execution session (.session SQLite on Drive): exchanges, messages, participants | Implemented (types + Drive storage + mapper). RoutineExchange type defined |
| **Project** | Work container: name, description, driveFolderInode | Implemented (entity + CRUD). No metadata/tracking_number |
| **OperativeEquipment** | Tool binding to operative: skill or mcp_tool (selector: serverName__toolName) | Implemented (entity + policy derivation) |

---

## Prerequisites

### Infrastructure
- [ ] Platform-infra running via Tilt (all services active)
- [ ] PostgreSQL, MinIO, Caddy -- active
- [ ] NATS -- active (or RabbitMQ as temporary substitute)
- [ ] MCP Hub runtime working (K8s pods can launch)

### MCP servers installed in workspace
- [ ] MCP Email Server (`@codefuturist/email-mcp`) installed and active
- [ ] MCP Server Trello (`mcp-server-trello`) installed and active
- [ ] MCP Google Calendar (`mcp-google-calendar`) installed and active
- [ ] Env vars / secrets for each MCP server configured via Vault

### Email accounts
- [ ] Mail App activated automatically (user installed email MCP)
- [ ] 3+ email accounts added through Mail App UI (dynamic app in App Service)
- [ ] Mail App manages email-mcp config.toml through sidecar API
- [ ] IMAP IDLE watcher enabled for real-time email receipt

### Calendar
- [ ] Calendar App activated (user installed GCal/Outlook Calendar MCP)
- [ ] Calendars synchronized through Calendar App

### Data
- [ ] Organization project "OrgName" created in App Service with description
- [ ] On Drive: /Projects/OrgName/ -- project root folder
- [ ] Inside: project folders /Projects/OrgName/{project_dir}/ with descriptions (description.md or metadata)
- [ ] Each project folder has inbox/ for incoming emails
- [ ] 5+ project folders with comprehensive descriptions for classification
- [ ] Trello: board exists with default column (e.g. "Inbox")
- [ ] Google Calendar: OAuth authorized (read-write scope)

### Drive Structure
```
/Projects/OrgName/                          -- organization project
  |-- .contacts/                            -- global organization contacts
  |-- .triage/inbox/                        -- low confidence emails
  |-- ProjectAlpha/                         -- project folder
  |     |-- description.md                  -- description for LLM classification
  |     |-- inbox/                          -- incoming emails
  |     |-- inbox/attachments/              -- attachments
  |     |-- .contacts/                      -- project contacts (sender binding)
  |     +-- reports/intake.xlsx             -- email registry
  |-- ProjectBeta/
  |     |-- description.md
  |     |-- inbox/
  |     +-- reports/intake.xlsx
  |-- ProjectGamma/
  |     ...
  +-- reports/                              -- consolidated organization reports
```

### Routines and operatives
- [ ] App Operative `@mail` activated automatically (equipment: email MCP tools)
- [ ] App Operative `@calendar` activated automatically (equipment: calendar MCP tools)
- [ ] Operative "project-dispatcher" created with equipment: `@mail` + `@calendar` + trello + drive tools
- [ ] Routine "email-intake" created: trigger=signal(email.received), steps defined
- [ ] Routine: at creation webhook URL + payload generated, crontab job created
- [ ] For rhythm -- crontab calls webhook on schedule
- [ ] For signal -- NATS event publishes to crontab -> crontab calls same webhook

---

## Scenario 1: Email Receipt via MCP Email and Project Classification

### Execution Flow

```
Email arrives at connected inbox
  |
  v
[Drive Crontab / NATS Event] -- triggers routine "email-intake"
  |
  v
[App Service: Routine Execution Engine]
  |-- creates routine_run (runId = ULID)
  |-- resolves operative by slug
  |-- creates Session on Drive (.session SQLite)
  |-- invokes Agent Hub (AgentService.invoke)
  |
  v
[Agent Hub: upgraide-agent]
  |
  +-- Step 1: email__list_emails (new unread)
  |     |
  |     v  [{uid, from, subject, date}]
  |
  +-- Step 2: FOR EACH email -> verification routine:
  |     |
  |     +-- 2a. email__get_email(uid) -> full content + attachments
  |     |
  |     +-- 2b. LLM classifies email by project descriptions
  |     |        (project descriptions loaded in operative context)
  |     |        -> verdict: {project_dir, confidence, reasoning}
  |     |
  |     +-- 2c. confidence < threshold? -> /Projects/.triage/inbox/
  |     |        confidence OK? -> continue:
  |     |
  |     +-- 2d. drive__upload -> /Projects/OrgName/{project_dir}/inbox/{date}_{subject}.eml
  |     |
  |     +-- 2e. trello__create_card -> card from template
  |     |
  |     +-- 2f. gcal__create_event -> event with links
  |     |
  |     +-- 2g. Excel: generate/update -> /Projects/OrgName/{project_dir}/reports/intake.xlsx
  |     |
  |     +-- 2h. email__mark_email(read=true) + email__add_label("Processed")
  |     |
  |     v  next email -> repeat 2a-2h
  |
  v
[Session: COMPLETED, routine_run: succeeded]
```

### Verification Steps

#### 1.1 Email Receipt and Reading via MCP Email

| # | Action | Expected | Service |
|---|--------|----------|---------|
| 1 | Send email to connected inbox | Email delivered (verify via MCP tool `search_messages`) | MCP Email Server |
| 2 | Routine trigger: crontab calls webhook (rhythm -- on schedule, signal -- NATS event -> crontab -> webhook) | routine_run created, Session created on Drive | Drive Crontab -> App Service |
| 3 | Operative invoked via AgentService.invoke() | Agent Hub receives request with tool policy (email + drive tools) | App Service -> Agent Hub |
| 4 | Agent calls `list_emails` via MCP (account, folder=INBOX, unread_only) | Returns paginated list of new emails with metadata | Agent Hub -> MCP Hub -> MCP Email |
| 5 | Agent calls `get_email` for each new email | Full content with body, headers, attachments, thread info | Agent Hub -> MCP Hub -> MCP Email |

**Verification:** Session on Drive contains framework messages with MCP tool call results.

#### 1.2 Iterative Verification of Each Email (LLM)

| # | Action | Expected | Service |
|---|--------|----------|---------|
| 6 | For each email: LLM receives content + all project descriptions (from operative context) | LLM iteratively verifies email-to-project membership | Agent Hub |
| 7 | LLM delivers verdict | {project_dir, confidence, reasoning} for each email | Agent Hub |
| 8 | When confidence < threshold | Email -> /Projects/.triage/inbox/, remaining steps skipped | Agent Hub -> Drive |

**Verification:** Session messages show verdict for each email: project_dir, confidence, reasoning.

#### 1.3 Saving Email to Project

| # | Action | Expected | Service |
|---|--------|----------|---------|
| 9 | Agent uploads email (.eml) to Drive via upload API | File at /Projects/OrgName/{project_dir}/inbox/{filename} | Agent Hub -> Drive |
| 10 | Drive processor indexes file | BM25 + FAISS artifacts created | Drive |
| 11 | Attachments uploaded separately | Files at /Projects/OrgName/{project_dir}/inbox/attachments/ | Agent Hub -> Drive |

**Verification:** `drive/paths/list` for /Projects/OrgName/{project_dir}/inbox/ returns new files.

---

## Scenario 2: Sender-to-Project Binding

### Steps

| # | Action | Expected | Service |
|---|--------|----------|---------|
| 1 | On first classification of email from new sender | Agent writes sender_email -> project_dir binding in project metadata on Drive | Agent Hub -> Drive |
| 2 | Binding saved as JSON at /Projects/OrgName/{project_dir}/.contacts/{sender_hash}.json | File contains: email, name, first_seen, last_seen, confidence | Drive |
| 3 | On next email from same sender | Agent first checks project contacts via `drive/tools/grep` | Agent Hub -> Drive |
| 4 | If match found -- skips LLM classification | Direct routing to project without re-verification | Agent Hub |

**Verification:** Repeat email from bound sender routes faster (no LLM step).

---

## Scenario 3: Trello Card Creation

### Steps

| # | Action | Expected | Service |
|---|--------|----------|---------|
| 1 | Agent forms card description from operative orders prompt template | Template: subject, sender, summary, link to Drive file | Agent Hub |
| 2 | Agent calls MCP tool `create_card` (board_id, list_id from project context) | Card created in default column | Agent Hub -> MCP Hub -> Trello |
| 3 | If project has tracking_number -- number included in card description | Card contains [TRACK-123] in title | Agent Hub |
| 4 | Card URL written to Session messages | Traceability: session -> trello card | Agent Hub |

**Verification:** Trello board card contains template description, Drive email link, tracking_number.

---

## Scenario 4: Calendar Event Creation

### Context

The platform has a built-in **Calendar App** -- analogous to Mail App for calendars. Calendar App:
- Activates when MCP Google Calendar or Outlook Calendar is installed
- Syncs events with external calendars via MCP
- Shows unified calendar view in platform
- Routines create events through Calendar App, which proxies to the appropriate MCP

### Steps

| # | Action | Expected | Service |
|---|--------|----------|---------|
| 1 | Agent extracts date/time from email context (LLM) | Date determined or fallback to current day | Agent Hub |
| 2 | Agent calls MCP tool `create_event` | Event: title, link to Trello card, link to Drive | Agent Hub -> MCP Hub -> GCal |
| 3 | Calendar App syncs event | Event visible in platform unified calendar view | Calendar App |
| 4 | Event URL written to Session | Traceability: session -> gcal event | Agent Hub |

**Verification:** Event visible in both Google Calendar and platform Calendar App.

---

## Scenario 5: Excel File Generation

### Steps

| # | Action | Expected | Service |
|---|--------|----------|---------|
| 1 | Agent generates data row from email per template | Columns: date, sender, subject, project, tracking_number, trello_url, gcal_url | Agent Hub |
| 2 | Agent checks existence of intake.xlsx in project | `drive/tools/ls` for /Projects/OrgName/{project_dir}/reports/ | Agent Hub -> Drive |
| 3 | If file exists -- downloads, adds row, uploads new version | File version incremented, Drive re-indexes | Agent Hub -> Drive |
| 4 | If file does not exist -- creates new from template | Headers + first data row | Agent Hub -> Drive |

**Verification:** intake.xlsx on Drive contains all processed project emails; file is a template for import into target system.

---

## Scenario 6: Project Tracking Number

### Steps

| # | Action | Expected | Service |
|---|--------|----------|---------|
| 1 | User assigns tracking_number to project | Attribute written to project metadata (App Service or Drive) | App Service |
| 2 | Routine "reprocess-project-documents" triggered | Finds all Trello cards/events/Excel linked to project | App Service -> Agent Hub |
| 3 | Agent updates Trello cards (update_card) | Adds [TRACK-XXX] to titles | Agent Hub -> MCP Hub -> Trello |
| 4 | Agent updates Excel (adds tracking_number column) | All rows receive number | Agent Hub -> Drive |
| 5 | New emails automatically contain tracking_number | Card/event/Excel template includes number | Agent Hub |

**Verification:** All project artifacts contain tracking_number.

---

## Scenario 7: Platform Dynamic Apps (Mail App, Calendar App)

### Pattern: Dynamic App = Operative + Sidecar UI + MCP

Each platform Dynamic App is a bundle of:
1. **Specialized Operative** (`@mail`, `@calendar`, `@drive`) -- manages application via chat and routines
2. **Dedicated UI** -- interface adapted for specific MCP sidecar (inbox view, calendar view, file browser)
3. **MCP Server + Sidecar** -- MCP pod with sidecar for dynamic configuration

Lifecycle:
1. User installs MCP server (email, calendar) via MCP Hub
2. App Service automatically activates Dynamic App: creates operative, enables UI
3. Operative accessible via `@mail`, `@calendar` in any project
4. UI manages MCP configuration through Sidecar (accounts, settings) without pod restart

| App | Operative | MCP Server | Sidecar manages | UI |
|-----|-----------|------------|-------------------|----|
| Mail App | `@mail` | `@codefuturist/email-mcp` | config.toml: accounts, watcher, hooks | Inbox view, accounts, compose |
| Calendar App | `@calendar` | `mcp-google-calendar` + Outlook MCP | OAuth credentials, calendar list | Unified calendar view, event create |
| Drive App | `@drive` | built-in (Drive Service) | -- (native service) | File browser, upload, search |

### Mail App

| # | Action | Expected | Service |
|---|--------|----------|---------|
| 1 | User installs `@codefuturist/email-mcp` via MCP Hub | Server in workspace registry, Mail App automatically activated | MCP Hub, App Service |
| 2 | Mail App UI shows inbox and accounts | Tool `list_accounts` + `list_emails` via MCP | App Service Web |
| 3 | User adds email account through Mail App UI | Dynamic App -> Sidecar updates config.toml -> IDLE watcher picks up inbox | App Service -> Sidecar |
| 4 | Adding 2nd/3rd account | New `[[accounts]]` block, without MCP pod restart | Sidecar |
| 5 | IMAP IDLE watcher detects new email | Webhook -> NATS (`email.received`) -> crontab -> routine trigger | MCP Email -> NATS -> Drive Crontab |

**config.toml for email-mcp (managed via Mail App + Sidecar):**
```toml
[[accounts]]
name = "work"
email = "user@company.com"
password = "app-password"
[accounts.imap]
host = "imap.gmail.com"
port = 993
tls = true
[accounts.smtp]
host = "smtp.gmail.com"
port = 465
tls = true

[settings.watcher]
enabled = true
folders = ["INBOX"]

[settings.hooks]
on_new_email = "notify"
[settings.hooks.alerts]
webhook_url = "http://nats-bridge.platform.svc/publish/email.received"
webhook_events = ["urgent", "high", "normal", "low"]
```

### Calendar App

| # | Action | Expected | Service |
|---|--------|----------|---------|
| 1 | User installs MCP Google Calendar (or Outlook Calendar) | Calendar App automatically activated | MCP Hub, App Service |
| 2 | Calendar App UI shows unified calendar view | Events from all connected calendars | App Service Web |
| 3 | User adds Google Calendar account through Calendar App | OAuth flow -> configuration passed to MCP via Sidecar | App Service -> Sidecar |
| 4 | User adds Outlook Calendar | Analogous flow, multi-provider | App Service -> Sidecar |
| 5 | Routine creates event via MCP `create_event` | Event appears in Calendar App (sync) and external calendar | Agent Hub -> MCP -> Calendar App |

**Verification:** Mail App and Calendar App activate automatically when corresponding MCP servers are installed. Multi-account managed through Dynamic App UI.

### IMAP IDLE as Source of Signal Events

`@codefuturist/email-mcp` has a built-in IMAP IDLE watcher with webhook alerts. This enables using MCP Email as a source of events for NATS without additional integration:

```
email-mcp (IMAP IDLE) -> webhook -> NATS Bridge -> NATS(email.received)
  -> Drive Crontab (subscriber) -> one-shot HTTP job -> routine webhook
```

---

## Scenario 8: Scale -- Hundreds of Projects per Month

### Steps

| # | Action | Expected | Service |
|---|--------|----------|---------|
| 1 | Create 100+ project folders inside /Projects/OrgName/ with description.md | Folders with inbox/ initialized | Drive |
| 2 | Send 500+ emails to different inboxes over a week | All emails classified and routed | Routine Execution Engine |
| 3 | Check processing latency | P95 < 30s per email (MCP email + LLM + MCP trello + MCP gcal + Drive) | All |
| 4 | Check routing accuracy | >95% of emails routed to correct project | Agent Hub |
| 5 | Check idempotency | Repeat routine_run does not create duplicates (runId as key) | App Service |
| 6 | Check fault tolerance | MCP Trello failure -> retry -> email still saved to Drive | Agent Hub |

**Verification:** Latency, accuracy, retry rate metrics within SLA.

---

## GAP Analysis: Current State vs. Requirements

### Status Legend

- **Implemented** -- code works, can be tested
- **Partial** -- entity/types/framework exist, no execution path
- **Design only** -- specification exists (md), no code
- **Missing** -- no code and no specification

### Critical Gaps (pipeline blockers)

| # | Gap | What Exists | What is Needed | Affected Services | Priority |
|---|-----|-------------|----------------|-------------------|----------|
| G1 | **Routine Execution Engine not implemented** | Design doc (`docs/routine-execution-design.md`), session types with RoutineExchange, ParticipantKind='routine_run' | RoutineExecutionService in app-service: resolve routine -> create session -> invoke agent -> persist -> update stats. Endpoint `POST /api/internal/routines/execute` + InternalRouteGuard | App Service | P0 |
| G2 | **Routines -- in-memory seed, no persistence** | Entity `routine.entity.ts` defined (TypeORM), service runs on Map with seed data. Design doc for Drive storage (`docs/routines-crud-design.md`) | Either: (a) apply TypeORM migration for routines table, (b) implement Drive module `drive_routines` per spec. SDK client in platform-api | App Service, Drive | P0 |
| G3 | **Routine does not generate webhook URL at creation** | Crontab scheduler works (95%), parser handles HTTP jobs. Crontab calls webhook with payload | On routine creation -- generate webhook route in App Service (e.g. `POST /api/webhooks/routines/{routineId}/trigger`), pass URL + payload to crontab job. Crontab stays purely HTTP-based | App Service | P0 |
| G4 | **NATS event bus not deployed** | RabbitMQ deployed but unused. No event bus integrated | Deploy NATS. Signal events (email.received etc.) published to NATS -> Drive crontab subscribed to subjects -> creates one-shot HTTP job -> calls webhook. Unified mechanism: crontab always = webhook | Platform Infra, Drive | P0 |
| G5 | **No Excel generation** | Drive XLSX processor reads Excel. `builtin_excel_expression` -- formulas only. `download-table.ts` -- export existing data | Add tool/skill for XLSX import template generation (exceljs or openpyxl). Either MCP server or builtin agent tool | Agent Hub or MCP Hub | P1 |

### Integration Gaps

| # | Gap | What Exists | What is Needed | Affected Services | Priority |
|---|-----|-------------|----------------|-------------------|----------|
| G6 | **MCP Sidecar pattern not implemented** | `@codefuturist/email-mcp` manages accounts via config.toml. CLI `account add/edit/delete` exists | Sidecar container alongside MCP pod: REST API for CRUD config.toml -> signal reload. Generic pattern for all MCP servers requiring dynamic configuration | MCP Hub | P1 |
| G7 | **Dynamic Apps not implemented (Mail App, Calendar App)** | Dynamic App stub exists in App Service. MCP tools available | Each App = Operative (`@mail`, `@calendar`) + dedicated UI + MCP Sidecar. Operative created automatically on MCP install. UI adapted for specific MCP sidecar. Auto-activation on install | App Service | P1 |
| G8 | **No auto-creation of project folders with inbox/** | Drive creates /Projects/OrgName/ on demand. No automatic subfolders {project_dir}/inbox/, .contacts/, reports/ | On first email routing to project_dir -- auto-create inbox/, .contacts/, reports/ if they don't exist | Drive, Agent Hub | P1 |
| G9 | **No tracking_number on project** | Project entity: id, name, description, driveFolderInode, isSystem. No extensible metadata | Add `metadata: jsonb` field or separate `trackingNumber` field. Migration + CRUD | App Service | P1 |
| G10 | **No sender -> project binding** | No "project contact" entity. No email -> project mapping mechanism | Store contacts as JSON files in /Projects/OrgName/{project_dir}/.contacts/ on Drive. Agent reads during routing | Drive, Agent Hub | P2 |
| G11 | **No document reprocessing on attribute change** | No event: project.metadata.changed. No routine for batch-update Trello/Excel | Routine "reprocess-on-tracking-number" + event in NATS | App Service, NATS | P2 |

### Infrastructure Gaps

| # | Gap | What Exists | What is Needed | Affected Services | Priority |
|---|-----|-------------|----------------|-------------------|----------|
| G12 | **No execution tracing** | Session stores messages, but no session -> tool calls -> external results linkage | routine_execution_runs projection table (design ready). Audit tool calls in session messages | App Service | P2 |
| G13 | **Tool discovery -- agent doesn't know what's installed** | MCP Registry Gateway in operatives/ resolves equipment. Agent receives tool policy | Agent should receive full list of available tools (not just policy allow list) before invocation | Agent Hub, MCP Hub | P2 |
| G14 | **MCP sidecar pattern -- generic mechanism** | Missing | Sidecar architecture for MCP: platform containers alongside MCP pods for managing configuration, secrets, multi-accounts without restart | MCP Hub | P1 |

---

## Coverage Matrix: What is Implemented in Code

### Entities and Services

| Component | File | Status |
|-----------|------|--------|
| Operative entity | `app-service/src/operatives/operative.entity.ts` | Implemented |
| OperativeEquipment entity | `app-service/src/operatives/operative-equipment.entity.ts` | Implemented |
| Operative tool policy | `app-service/src/operatives/operative-tool-policy.ts` | Implemented |
| MCP Registry Gateway | `app-service/src/operatives/mcp-registry.gateway.ts` | Implemented |
| Routine entity (TypeORM) | `app-service/src/routines/routine.entity.ts` | Defined, migration not applied |
| Routine service | `app-service/src/routines/routines.service.ts` | In-memory seed (TODO: DB) |
| Session types (RoutineExchange) | `app-service/src/sessions/types/session.types.ts` | Types defined |
| Session Drive mapper | `app-service/src/sessions/services/session-drive.mapper.ts` | Implemented |
| Drive crontab scheduler | `drive/modules/drive_crontab/services/scheduler_service.py` | Working (HTTP jobs) |
| Drive crontab parser | `drive/modules/drive_crontab/services/crontab_parsing.py` | Working (HTTP jobs, webhook URLs) |
| Agent service (LLM invoke) | `app-service/src/ai-chat/agent.service.ts` | Implemented |
| MCP Hub catalog seed | `mcp-hub/packages/hub/prisma/seed.ts` | Implemented (10+ servers) |
| Project entity | `app-service/src/projects/projects.entity.ts` | Implemented, no metadata |
| RoutineExecutionService | -- | Design doc only |
| InternalRouteGuard | -- | Not implemented |
| routine_execution_runs table | -- | Design doc only |
| Drive routines module | -- | Design doc only (570 lines) |
| diskd-sdk routines client | -- | Design doc only |
| NATS integration | -- | Not implemented |

### MCP Servers in Catalog

| Server | Tools | Needed for Scenario | MCP Hub Status |
|--------|-------|-------------------|---------------|
| @codefuturist/email-mcp | 47: list_emails, get_email, search_emails, send_email, reply_email, forward_email, move_email, mark_email, bulk_action, list_labels, add_label, extract_calendar, schedule_email, get_email_stats, get_thread, download_attachment, save_draft, list_accounts, check_health etc. | Reading, search, sending, labels, scheduling, IMAP IDLE watcher, AI triage, calendar extraction, analytics | In catalog seed |
| mcp-server-trello | 11: list_boards, list_lists, create_card, update_card, move_card, add_comment, attach_file etc. | Card creation | In catalog seed |
| mcp-google-calendar | 6: list_calendars, list_events, create_event, update_event, delete_event, extract_events_from_image | Event creation | In catalog seed |

---

## Inter-Service Dependencies (Sequence)

Detailed diagram provided above in "Component Diagram" and "Data Flow Diagram" sections.

Brief sequence:

```
Crontab (rhythm or NATS signal) -> webhook -> RoutineExecutionService
  -> Session + routine_run -> AgentService.invoke()
    -> Agent Hub: email tools -> drive tools -> trello -> gcal -> excel
      -> Session flushed -> routine_run: succeeded
```

---

## Tester Checklist

### Phase 0: Component Smoke Tests (can do now)

- [ ] **MCP Email:** install mcp-email-server in workspace, call `search_messages` via MCP Hub JSON-RPC `/v1/mcp`
- [ ] **MCP Trello:** install mcp-server-trello, call `list_boards`, then `create_card`
- [ ] **MCP GCal:** install mcp-google-calendar, call `list_calendars`, then `create_event`
- [ ] **Drive:** create project OrgName, create project folder /Projects/OrgName/{project_dir}/inbox/ via `drive/paths/create`
- [ ] **Operative:** create operative with equipment = [mcp-email-server tools], verify tool policy
- [ ] **Agent chat:** send message @operative_slug in chat, verify agent invokes MCP tools

### Phase 1: Integration (after closing G1-G3)

- [ ] **Routine trigger:** crontab calls webhook `POST /api/webhooks/routines/{id}/trigger` with payload (both rhythm and signal)
- [ ] **Session creation:** routine_run creates Session on Drive with RoutineExchange
- [ ] **E2E basic:** crontab trigger -> agent reads email -> classifies -> saves to Drive

### Phase 2: Full Pipeline (after closing G4-G9)

- [ ] **E2E full:** email -> classify -> Drive -> Trello card -> GCal event -> Excel
- [ ] **Sender binding:** repeat email routes without LLM
- [ ] **Tracking number:** assign number -> verify in new cards
- [ ] **Multi-account:** add second email via sidecar without restart

### Phase 3: Scale (after closing all gaps)

- [ ] **100 projects, 500 emails:** all processed correctly
- [ ] **Idempotency:** runId prevents duplicates
- [ ] **Error recovery:** MCP Trello down -> retry -> Drive save not lost
- [ ] **Signal path:** NATS event `email.received` -> Drive crontab creates one-shot job -> webhook -> RoutineExecutionService
- [ ] **Unified mechanism:** both rhythm and signal converge through crontab webhook into single RoutineExecutionService

---

## Recommended Gap Closure Order

```
Phase 1 (Execution Engine MVP):
  G1 RoutineExecutionService + webhook route for trigger
  G2 Routines persistence (TypeORM migration or Drive module)
  G3 Routine generates webhook URL at creation -> crontab job

Phase 2 (Event Bus + Dynamic Apps):
  G4 NATS deployment + signal triggers
  G6 MCP Sidecar pattern (config management)
  G7 Dynamic Apps: Mail App + Calendar App

Phase 3 (Output Pipeline):
  G5 Excel generation (agent tool or MCP)
  G8 Auto-create /Projects/{name}/inbox/
  G9 tracking_number on project
  G10 Sender -> project binding

Phase 4 (Polish):
  G11 Reprocessing on attribute change
  G12 Execution tracing
  G13 Tool discovery
  G14 MCP sidecar pattern (generic)
```

---

## References to Specifications and Code

### Design docs
- Routine execution: `docs/routine-execution-design.md` (master cross-project doc)
- Routines CRUD: `docs/routines-crud-design.md` (Drive storage + SDK)
- Session model: `app-service/docs/design/routine-execution-session.md`
- Drive crontab: `drive/docs/drive-crontab-design.md`

### Code (implemented)
- Operative + equipment: `app-service/app-service/src/operatives/`
- Session types: `app-service/app-service/src/sessions/types/session.types.ts`
- Agent service: `app-service/app-service/src/ai-chat/agent.service.ts`
- Routine entity: `app-service/app-service/src/routines/routine.entity.ts`
- Drive crontab: `drive/modules/drive_crontab/`
- MCP Hub catalog: `mcp-hub/packages/hub/prisma/seed.ts`

### Platform
- C4 design: `mono/c4design.md`
- Drive API: `drive/modules/drive/API.md`
- Platform SDK: `platform-api/`

---

## @diskd-ai/sdk Readiness for Pipeline Implementation

### SDK Modules Available Today

The `@diskd-ai/sdk` provides typed clients for most services involved in this pipeline. Below is a mapping of pipeline operations to existing SDK capabilities and identified gaps.

### What the SDK Already Covers

| Pipeline Operation | SDK Module | Methods | Ready? |
|-------------------|------------|---------|--------|
| **File upload** (email .eml, attachments, contacts JSON, Excel) | `diskd.os.drive()` | `drive.upload.file({ name, data, parentInode })` | YES |
| **File download** (existing intake.xlsx for append) | `diskd.os.drive()` | `drive.download.file({ inode })` | YES |
| **Directory listing** (check inbox/, reports/ contents) | `diskd.os.drive()` | `drive.list({ path })`, `drive.tools.ls({ path })` | YES |
| **Directory creation** (inbox/, .contacts/, reports/) | `diskd.os.drive()` | `drive.create({ dirName, parentInode })` | YES |
| **File search** (grep for sender contacts) | `diskd.os.drive()` | `drive.tools.grep({ pattern, path })` | YES |
| **Glob match** (find .contacts/*.json) | `diskd.os.drive()` | `drive.tools.glob({ pattern, parentInode })` | YES |
| **File metadata** (version check for Excel) | `diskd.os.drive()` | `drive.files.metadata({ inode })` | YES |
| **Update metadata** (custom metadata on paths) | `diskd.os.drive()` | `drive.updateMetadata({ inode, metadata })` | YES |
| **Session start** (routine execution session) | `diskd.platform.sessions()` | `sessions.start({ title })` | YES |
| **Session append** (log tool call results) | `diskd.platform.sessions()` | `session.append(messages)` | YES |
| **Session list/open** (audit, tracing) | `diskd.platform.sessions()` | `sessions.list()`, `sessions.open({ sessionId })` | YES |
| **Crontab job creation** (rhythm trigger) | `diskd.platform.crontab()` | `crontab.createJob({ job })` | YES |
| **Crontab job run** (manual trigger) | `diskd.platform.crontab()` | `crontab.runJob({ jobId })` | YES |
| **Crontab status** | `diskd.platform.crontab()` | `crontab.getStatus()`, `crontab.listJobs()` | YES |
| **Agent invocation** (LLM orchestration) | `diskd.os.agents()` | `agents.invoke({ agentName, query, context })` | YES |
| **Agent streaming** (tool call events) | `diskd.os.agents()` | `StreamProtocolHandler` with 30+ event types | YES |
| **LLM completions** (classification, extraction) | `diskd.os.llm()` | `llm.completions.create(params)`, `llm.completions.stream(params)` | YES |
| **MCP server install** | `diskd.os.mcp()` | `mcp.registry.addServer({ catalogServerId })` | YES |
| **MCP server env vars** | `diskd.os.mcp()` | `mcp.registry.upsertEnvVar(serverId, { key, value })` | YES |
| **MCP server list/status** | `diskd.os.mcp()` | `mcp.registry.list()`, `mcp.registry.getServerLogs()` | YES |
| **MCP catalog browse** | `diskd.os.mcp()` | `mcp.catalog.list({ search })`, `mcp.catalog.getServerDetails()` | YES |
| **Drive DB** (session SQLite, structured data) | `diskd.os.database()` | Full CRUD via `db.repository(table)` | YES |

### SDK Gaps for Pipeline Implementation

| # | Gap | What is Missing in SDK | Why It Matters | Priority |
|---|-----|----------------------|----------------|----------|
| S1 | **No Routines client** | No `diskd.platform.routines()` module. Routine CRUD (create, list, get, update, delete) not exposed | Cannot create "email-intake" routine programmatically. Must use raw HTTP or wait for App Service REST API | P0 |
| S2 | **No Routine Execution client** | No `diskd.platform.routineRuns()` or similar. Cannot trigger routine, query run status, list runs | Cannot trigger `POST /api/webhooks/routines/{id}/trigger` through SDK. No typed interface for routine_run lifecycle | P0 |
| S3 | **No Projects client** | No `diskd.platform.projects()` module. Project CRUD not in SDK | Cannot create "OrgName" project, query project metadata, assign tracking_number programmatically through SDK | P0 |
| S4 | **No Operatives client** | No `diskd.platform.operatives()` module. Operative CRUD, equipment management not in SDK | Cannot create "project-dispatcher" operative or assign MCP tools to equipment through SDK | P1 |
| S5 | **No MCP tool invocation** | `diskd.os.mcp()` manages registry/catalog but has no `mcp.tools.call(serverId, toolName, params)` | Cannot directly invoke email-mcp `list_emails`, trello `create_card`, gcal `create_event` from SDK. Must go through Agent Hub invoke | P1 |
| S6 | **No NATS/Event bus client** | No event publishing/subscribing module | Cannot publish `email.received` events or subscribe to event streams. Implementation will need raw NATS client | P1 |
| S7 | **No Workspace client** | No `diskd.platform.workspaces()` for workspace-level operations | Cannot query workspace settings, installed apps, active Dynamic Apps | P2 |
| S8 | **No Dynamic Apps client** | No `diskd.platform.apps()` for Dynamic App lifecycle | Cannot query app activation status, trigger app activation, manage sidecar config | P2 |
| S9 | **No Drive path-by-path resolution** | `drive.list()` takes `path` but `drive.upload.file()` takes `parentInode` only | For path-based operations like "upload to /Projects/OrgName/Alpha/inbox/", must first resolve path to inode manually. No `drive.resolveByPath(path)` convenience method | P2 |
| S10 | **No Sidecar management client** | No `diskd.os.mcp().sidecar.*` methods | Cannot manage MCP sidecar config (email accounts, calendar OAuth) through SDK. Will need custom HTTP client for sidecar REST API | P2 |

### SDK Usage Map for Each Scenario

```
Scenario 1 (Email Receipt + Classification):
  AVAILABLE: drive.upload.file, drive.list, drive.create,
             agents.invoke (for LLM classification),
             sessions.start, session.append
  MISSING:   routines client (S1), routine execution trigger (S2),
             projects client for metadata (S3)

Scenario 2 (Sender Binding):
  AVAILABLE: drive.upload.file (write .contacts JSON),
             drive.tools.grep (search contacts),
             drive.tools.glob (list .contacts/*.json)
  MISSING:   nothing critical -- can be done with existing Drive tools

Scenario 3 (Trello Card):
  AVAILABLE: agents.invoke (agent calls MCP trello tools)
  MISSING:   direct MCP tool call (S5) -- must go through agent

Scenario 4 (Calendar Event):
  AVAILABLE: agents.invoke (agent calls MCP gcal tools)
  MISSING:   direct MCP tool call (S5) -- must go through agent

Scenario 5 (Excel Generation):
  AVAILABLE: drive.download.file, drive.upload.file,
             drive.tools.ls, drive.files.metadata
  MISSING:   nothing in SDK -- Excel generation is an agent tool gap (G5)

Scenario 6 (Tracking Number):
  AVAILABLE: drive.updateMetadata (for Drive-side metadata)
  MISSING:   projects client (S3) for App Service project metadata

Scenario 7 (Dynamic Apps):
  AVAILABLE: mcp.registry.addServer, mcp.registry.upsertEnvVar
  MISSING:   dynamic apps client (S8), sidecar client (S10),
             operatives client (S4)

Scenario 8 (Scale):
  AVAILABLE: all Drive operations, crontab, sessions
  MISSING:   routines client (S1), routine runs client (S2)
```

### Recommended SDK Extension Priorities

```
Phase 1 (unblocks Execution Engine):
  S1 diskd.platform.routines()     -- CRUD for routines
  S2 diskd.platform.routineRuns()  -- trigger, status, list runs
  S3 diskd.platform.projects()     -- CRUD + metadata

Phase 2 (unblocks Dynamic Apps + automation):
  S4 diskd.platform.operatives()   -- CRUD + equipment
  S5 diskd.os.mcp().tools.call()   -- direct MCP tool invocation
  S6 diskd.platform.events()       -- NATS publish/subscribe

Phase 3 (convenience + polish):
  S7  diskd.platform.workspaces()  -- workspace operations
  S8  diskd.platform.apps()        -- Dynamic App lifecycle
  S9  drive.resolveByPath(path)    -- path-to-inode resolution
  S10 diskd.os.mcp().sidecar.*     -- sidecar config management
```
