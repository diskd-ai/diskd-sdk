/**
 * DiskD SDK -- Tracking Number Assignment Routine Setup (G9)
 *
 * Creates (or updates) an operative with tracking-assignment orders and
 * registers a 4-step routine that scans project topic folders, assigns
 * TRACK-NNN numbers to untracked folders, and updates intake reports.
 *
 * Usage:
 *   npx tsx examples/node/setup-tracking-routine.ts
 *
 * Environment:
 *   DISKD_API_KEY      - API key for auth
 *   DISKD_WORKSPACE_ID - workspace ID
 *   PROJECT_NAME       - project name (e.g., "OrgName")
 *   OPERATIVE_SLUG     - operative slug (default: "tracking-assigner")
 */

import type { Operative, RoutineStep } from '@diskd-ai/sdk';
import { diskd } from '@diskd-ai/sdk';

// ---------------------------------------------------------------------------
// Config (read from env)
// ---------------------------------------------------------------------------

const API_KEY = process.env.DISKD_API_KEY ?? '';
const WORKSPACE_ID = process.env.DISKD_WORKSPACE_ID ?? '';
const PROJECT_NAME = process.env.PROJECT_NAME ?? '';
const OPERATIVE_SLUG = process.env.OPERATIVE_SLUG ?? 'tracking-assigner';

// ---------------------------------------------------------------------------
// Pure content definitions
// ---------------------------------------------------------------------------

const TRACKING_OPERATIVE_ORDERS = `You are a tracking number assignment agent. Your job is to scan topic folders
under this project and assign tracking numbers to folders that don't have one yet.

## Conventions

- Each topic folder may contain a \`tracking_number.md\` file
- If \`tracking_number.md\` exists, the folder already has a tracking number -- skip it
- If \`tracking_number.md\` is absent, the folder needs a tracking number assigned
- Tracking numbers follow the format TRACK-NNN (zero-padded to 3 digits)
- To find the next number, read existing tracking_number.md files and increment the highest

## File structure

/Projects/{ProjectName}/
  TopicAlpha/
    description.md          -- topic description
    tracking_number.md      -- "TRACK-001" (if assigned)
    inbox/                  -- emails
    reports/intake.xlsx     -- email registry
  TopicBeta/
    description.md
    inbox/
    ...
  .triage/inbox/            -- unclassified emails
  .contacts/                -- global contacts`;

const TRACKING_ROUTINE_STEPS: readonly RoutineStep[] = [
  {
    id: 'step-discover',
    name: 'Discover unassigned topics',
    action:
      'Use drive/ls on the project root, then drive/ls each subfolder to check for tracking_number.md. ' +
      'Skip directories starting with a dot (.triage, .contacts, .routines). ' +
      'Collect the list of folders that do not have a tracking_number.md file.',
    order: 1,
  },
  {
    id: 'step-read-existing',
    name: 'Read existing tracking numbers',
    action:
      'For each folder that already has a tracking_number.md file, use drive/read to read it. ' +
      'Parse the TRACK-NNN value and determine the highest existing number.',
    order: 2,
  },
  {
    id: 'step-assign',
    name: 'Assign tracking numbers',
    action:
      'For each unassigned folder (from step 1): determine the next TRACK-NNN by incrementing ' +
      'the highest number found in step 2 (or starting at TRACK-001 if none exist). ' +
      'Use drive/write to create tracking_number.md with the assigned number.',
    order: 3,
  },
  {
    id: 'step-update-reports',
    name: 'Update intake reports',
    action:
      'For each newly assigned folder: use drive/excel-write to append a row to ' +
      'reports/intake.xlsx (creating the file if absent) with columns: ' +
      '[date, topic, tracking_number, status]. ' +
      "Set date to today's date (YYYY-MM-DD), topic to the folder name, " +
      'tracking_number to the assigned TRACK-NNN, and status to "new".',
    order: 4,
  },
];

const ROUTINE_NAME = 'Assign Tracking Numbers';
const ROUTINE_DESCRIPTION =
  'Scans project topic folders for missing tracking numbers, assigns TRACK-NNN values, ' +
  'and updates intake reports.';

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
  // Validate config
  const configErrors = validateConfig();
  if (configErrors.length > 0) {
    for (const err of configErrors) {
      console.error(`  Missing env var: ${err.field} (${err.message})`);
    }
    process.exitCode = 1;
    return;
  }

  console.log();
  console.log('DiskD -- Setup Tracking Number Assignment Routine');
  console.log('-'.repeat(50));
  console.log(`  Project:   ${PROJECT_NAME}`);
  console.log(`  Operative: ${OPERATIVE_SLUG}`);
  console.log('-'.repeat(50));
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
  let operative: Operative;
  try {
    operative = await operatives.getBySlug({ projectId: project.id, slug: OPERATIVE_SLUG });
    console.log(`  Found existing operative: ${operative.name} (${operative.id})`);
    // Update orders if they differ
    if (operative.orders !== TRACKING_OPERATIVE_ORDERS) {
      operative = await operatives.update(operative.id, { orders: TRACKING_OPERATIVE_ORDERS });
      console.log('  Updated operative orders.');
    }
  } catch {
    // Operative not found -- create it
    operative = await operatives.create({
      projectId: project.id,
      name: 'Tracking Assigner',
      slug: OPERATIVE_SLUG,
      orders: TRACKING_OPERATIVE_ORDERS,
    });
    console.log(`  Created operative: ${operative.name} (${operative.id})`);
  }

  // 4. Create routine
  console.log('[3/4] Creating routine...');
  const routines = diskd.platform.routines({ auth });
  const routine = await routines.create({
    name: ROUTINE_NAME,
    description: ROUTINE_DESCRIPTION,
    icon: '#',
    operativeSlug: OPERATIVE_SLUG,
    scope: 'project',
    projectName: PROJECT_NAME,
    steps: TRACKING_ROUTINE_STEPS,
  });
  console.log(`  Created routine: ${routine.name} (slug: ${routine.slug})`);

  // 5. Summary
  console.log('[4/4] Done.');
  console.log();
  console.log('-'.repeat(50));
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
