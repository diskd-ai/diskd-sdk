/**
 * DiskD SDK -- Email Intake Sorting Routine Setup (Phase A + G10 Sender Binding)
 *
 * Creates (or updates) an operative with email intake orders and registers
 * a multi-step routine that classifies incoming emails into topic folders,
 * creates sender-to-topic bindings, and generates artifacts (Trello, GCal, Excel).
 *
 * This covers Phase A of the two-phase email pipeline:
 * - Phase A (this routine): email intake, classification, sender binding
 * - Phase B (setup-tracking-routine.ts): tracking number assignment
 *
 * Usage:
 *   npx tsx examples/node/setup-intake-routine.ts
 *
 * Environment:
 *   DISKD_API_KEY      - API key for auth
 *   DISKD_WORKSPACE_ID - workspace ID
 *   PROJECT_NAME       - project name (e.g., "OrgName")
 *   OPERATIVE_SLUG     - operative slug (default: "email-sorter")
 */

import type { RoutineStep } from '@diskd-ai/sdk';
import { diskd } from '@diskd-ai/sdk';

// ---------------------------------------------------------------------------
// Config (read from env)
// ---------------------------------------------------------------------------

const API_KEY = process.env.DISKD_API_KEY ?? '';
const WORKSPACE_ID = process.env.DISKD_WORKSPACE_ID ?? '';
const PROJECT_NAME = process.env.PROJECT_NAME ?? '';
const OPERATIVE_SLUG = process.env.OPERATIVE_SLUG ?? 'email-sorter';

// ---------------------------------------------------------------------------
// Pure content definitions
// ---------------------------------------------------------------------------

const INTAKE_OPERATIVE_ORDERS = `You are an email intake sorting agent. Your job is to classify incoming emails
into topic folders and maintain sender-to-topic bindings for fast re-routing.

## Classification workflow

For each new email:

1. Extract the sender email address from the "from" field.
2. Compute the sender hash: take the lowercase trimmed email, compute SHA-256,
   and use the first 16 hex characters as the hash.
3. Check for an existing sender binding:
   - Use drive/glob with pattern "*/.contacts/{hash}.json" under the project root.
   - If found, use drive/read to load the contact JSON.
4. If a binding exists with confidence >= 0.8:
   - Route the email directly to {topic_path}/inbox/ without LLM classification.
   - Update the contact file: increment classification_count, set last_seen to today.
   - Use drive/write to save the updated contact JSON.
5. If no binding exists or confidence < 0.8:
   - List all topic folders under the project root (skip directories starting with a dot).
   - Read description.md from each topic folder for context.
   - Classify the email against topic descriptions based on content and subject.
   - Route the email to the best-matching topic's inbox/ folder.
   - If no topic matches with sufficient confidence, route to .triage/inbox/.
6. After classification, create or update the sender binding:
   - Write to {topic}/.contacts/{hash}.json with the contact JSON schema.
   - Set confidence to the LLM's classification confidence (0.0-1.0).
   - If the sender was previously bound to a different topic, write the new
     binding in the new topic's .contacts/ directory.

## Contact JSON schema

File: {topic}/.contacts/{hash}.json

{
  "email": "sender@example.com",
  "name": "Sender Name",
  "topic_path": "/Projects/OrgName/TopicAlpha",
  "first_seen": "2026-03-17",
  "last_seen": "2026-03-17",
  "confidence": 0.95,
  "classification_count": 1
}

## Topic folder scaffolding

When classifying an email to a topic folder that does not have the standard
structure (inbox/, .contacts/, reports/), use drive/scaffold with template
"email-topic" to create the structure before routing the email.

For a new project that lacks org-level scaffolding (.contacts/, .triage/),
use drive/scaffold with template "email-org" first.

## Email routing

- Save email content to {topic}/inbox/{YYYY-MM-DD}_{subject_slug}.md
- Save attachments to {topic}/inbox/attachments/
- Low-confidence classifications go to .triage/inbox/

## Artifact creation (per email)

After routing each email:
- Update reports/intake.xlsx using drive/excel-write with columns:
  [date, sender, subject, topic, status]
- Mark the email as read using email__mark_email(read=true)`;

const INTAKE_ROUTINE_STEPS: readonly RoutineStep[] = [
  {
    id: 'step-fetch-emails',
    name: 'Fetch new emails',
    action:
      'Use email__list_emails to get unread emails from the inbox. ' +
      'For each email, use email__get_email to retrieve full content, headers, and attachments.',
    order: 1,
  },
  {
    id: 'step-check-contacts',
    name: 'Check sender bindings',
    action:
      'For each email, compute the sender hash (first 16 hex chars of SHA-256 of lowercase email). ' +
      'Use drive/glob to search for */.contacts/{hash}.json under the project root. ' +
      'If found with confidence >= 0.8, record the topic_path for direct routing. ' +
      'If not found or confidence < 0.8, mark for LLM classification.',
    order: 2,
  },
  {
    id: 'step-classify-and-route',
    name: 'Classify and route emails',
    action:
      'For emails needing classification: list topic folders, read description.md from each, ' +
      'classify email content against descriptions. Route to best match or .triage/inbox/ if low confidence. ' +
      'For emails with existing high-confidence bindings: route directly to the bound topic. ' +
      'Use drive/scaffold (email-topic) to create missing topic structure before routing. ' +
      'Save email to {topic}/inbox/{date}_{subject}.md. Save attachments to inbox/attachments/.',
    order: 3,
  },
  {
    id: 'step-update-bindings-and-reports',
    name: 'Update sender bindings and reports',
    action:
      'For each routed email: create or update the sender binding in {topic}/.contacts/{hash}.json ' +
      'using drive/write. Set confidence, update last_seen and classification_count. ' +
      'Update reports/intake.xlsx using drive/excel-write with columns [date, sender, subject, topic, status]. ' +
      'Mark email as read using email__mark_email.',
    order: 4,
  },
];

const ROUTINE_NAME = 'Email Intake Sorting';
const ROUTINE_DESCRIPTION =
  'Classifies incoming emails into topic folders using sender bindings and LLM analysis. ' +
  'Maintains sender-to-topic contact files for fast re-routing of repeat senders.';

// ---------------------------------------------------------------------------
// Validation (pure)
// ---------------------------------------------------------------------------

type ConfigError = { readonly field: string; readonly message: string };

const validateConfig = (): readonly ConfigError[] => {
  const errors: ConfigError[] = [];
  if (API_KEY.length === 0) {
    errors.push({ field: 'DISKD_API_KEY', message: 'required' });
  }
  if (WORKSPACE_ID.length === 0) {
    errors.push({ field: 'DISKD_WORKSPACE_ID', message: 'required' });
  }
  if (PROJECT_NAME.length === 0) {
    errors.push({ field: 'PROJECT_NAME', message: 'required' });
  }
  return errors;
};

// ---------------------------------------------------------------------------
// Main (composition root -- effectful)
// ---------------------------------------------------------------------------

const main = async (): Promise<void> => {
  const configErrors = validateConfig();
  if (configErrors.length > 0) {
    for (const err of configErrors) {
      console.error(`  Missing env var: ${err.field} (${err.message})`);
    }
    process.exitCode = 1;
    return;
  }

  console.log();
  console.log('DiskD -- Setup Email Intake Sorting Routine (Phase A + G10)');
  console.log('-'.repeat(55));
  console.log(`  Project:   ${PROJECT_NAME}`);
  console.log(`  Operative: ${OPERATIVE_SLUG}`);
  console.log('-'.repeat(55));
  console.log();

  // 1. Auth
  const auth = diskd.auth.apiKey({ apiKey: API_KEY, workspaceId: WORKSPACE_ID });

  // 2. Resolve project ID
  console.log('[1/4] Resolving project...');
  const projects = diskd.platform.projects({ auth });
  const allProjects = await projects.list();
  const project = allProjects.find((p) => p.name === PROJECT_NAME);
  if (!project) {
    console.error(`  Project "${PROJECT_NAME}" not found.`);
    console.error(`  Available: ${allProjects.map((p) => p.name).join(', ')}`);
    process.exitCode = 1;
    return;
  }
  console.log(`  Found project: ${project.name} (${project.id})`);

  // 3. Find or create operative
  console.log('[2/4] Setting up operative...');
  const operatives = diskd.platform.operatives({ auth });
  let operative;
  try {
    operative = await operatives.getBySlug({ projectId: project.id, slug: OPERATIVE_SLUG });
    console.log(`  Found existing operative: ${operative.name} (${operative.id})`);
    if (operative.orders !== INTAKE_OPERATIVE_ORDERS) {
      operative = await operatives.update(operative.id, { orders: INTAKE_OPERATIVE_ORDERS });
      console.log('  Updated operative orders.');
    }
  } catch {
    operative = await operatives.create({
      projectId: project.id,
      name: 'Email Sorter',
      slug: OPERATIVE_SLUG,
      orders: INTAKE_OPERATIVE_ORDERS,
    });
    console.log(`  Created operative: ${operative.name} (${operative.id})`);
  }

  // 4. Create routine
  console.log('[3/4] Creating routine...');
  const routines = diskd.platform.routines({ auth });
  const routine = await routines.create({
    name: ROUTINE_NAME,
    description: ROUTINE_DESCRIPTION,
    icon: '@',
    operativeSlug: OPERATIVE_SLUG,
    scope: 'project',
    projectName: PROJECT_NAME,
    steps: INTAKE_ROUTINE_STEPS,
  });
  console.log(`  Created routine: ${routine.name} (slug: ${routine.slug})`);

  // 5. Summary
  console.log('[4/4] Done.');
  console.log();
  console.log('-'.repeat(55));
  console.log(`Routine slug: ${routine.slug}`);
  console.log(`Steps: ${routine.steps.length}`);
  for (const step of routine.steps) {
    console.log(`  ${step.order}. ${step.name}`);
  }
  console.log();
  console.log('Verify:');
  console.log(`  GET /api/routines/${routine.slug}?scope=project&projectName=${PROJECT_NAME}`);
  console.log();
};

main().catch((err: unknown) => {
  console.error('Error:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
