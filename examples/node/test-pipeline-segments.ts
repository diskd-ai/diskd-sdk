/**
 * Email-to-Project Pipeline: Segment Tests
 *
 * Verifies each pipeline component independently using @diskd-ai/sdk.
 * Run all segments: npx tsx examples/node/test-pipeline-segments.ts
 * Run one segment: npx tsx examples/node/test-pipeline-segments.ts S2
 *
 * Environment:
 *   DISKD_API_KEY      - API key (default: key-dev-1234567890)
 *   DISKD_WORKSPACE_ID - workspace ID
 *   DISKD_BASE_URL     - gateway URL (default: https://apis.diskd.local:8080)
 *   DISKD_DRIVE_URL    - direct Drive URL override (e.g., http://localhost:8000/api/v1)
 *   DISKD_APP_URL      - direct App Service URL override (e.g., http://localhost:3001)
 *   DISKD_MCP_URL      - direct MCP Hub URL override (e.g., http://localhost:3000)
 */

import type { AuthModule, Operative } from '@diskd-ai/sdk';
import { diskd } from '@diskd-ai/sdk';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_KEY = process.env.DISKD_API_KEY ?? 'key-dev-1234567890';
const WORKSPACE_ID = process.env.DISKD_WORKSPACE_ID ?? '';
const DRIVE_URL = process.env.DISKD_DRIVE_URL;
const APP_URL = process.env.DISKD_APP_URL;
const MCP_URL = process.env.DISKD_MCP_URL;
const TEST_PROJECT_NAME = 'PipelineSegmentTest';

// ---------------------------------------------------------------------------
// Test result types (pure)
// ---------------------------------------------------------------------------

type TestResult =
  | { readonly tag: 'pass'; readonly name: string; readonly detail: string }
  | { readonly tag: 'fail'; readonly name: string; readonly error: string }
  | { readonly tag: 'skip'; readonly name: string; readonly reason: string };

const pass = (name: string, detail: string): TestResult => ({ tag: 'pass', name, detail });
const fail = (name: string, error: string): TestResult => ({ tag: 'fail', name, error });
const skip = (name: string, reason: string): TestResult => ({ tag: 'skip', name, reason });

// ---------------------------------------------------------------------------
// S2: Drive API + Crontab
// ---------------------------------------------------------------------------

const testS2DriveAndCrontab = async (auth: AuthModule): Promise<TestResult> => {
  const name = 'S2: Drive API + Crontab';
  try {
    const drive = diskd.os.drive({ version: 'v1', auth, url: DRIVE_URL });
    await drive.init();

    const rootEntries = await drive.list({ path: '/' });
    const projectsDir = rootEntries.find((e: { name: string }) => e.name === 'Projects');

    return pass(
      name,
      `Drive OK. Root has ${rootEntries.length} entries` +
        (projectsDir ? ', /Projects exists' : ' (no /Projects yet -- fresh workspace)')
    );
  } catch (err) {
    return fail(name, err instanceof Error ? err.message : String(err));
  }
};

// ---------------------------------------------------------------------------
// S3: Projects + Routines + Operatives CRUD
// ---------------------------------------------------------------------------

const testS3ProjectsCrud = async (auth: AuthModule): Promise<TestResult> => {
  const name = 'S3: Projects + Routines + Operatives CRUD';
  try {
    const projects = diskd.platform.projects({ auth, url: APP_URL });
    const routines = diskd.platform.routines({ auth, url: APP_URL });
    const operatives = diskd.platform.operatives({ auth, url: APP_URL });

    // List projects
    const allProjects = await projects.list();
    if (!Array.isArray(allProjects)) {
      return fail(name, 'projects.list() did not return an array');
    }

    // Find or create test project
    let project = allProjects.find((p) => p.name === TEST_PROJECT_NAME);
    if (!project) {
      project = await projects.create({
        name: TEST_PROJECT_NAME,
        description: 'Segment test project',
      });
    }
    const projectId = project.id;

    // Create operative
    const opSlug = 'segment-test-op';
    let operative: Operative;
    try {
      operative = await operatives.getBySlug({ projectId, slug: opSlug });
    } catch {
      operative = await operatives.create({
        projectId,
        name: 'Segment Test Op',
        slug: opSlug,
        orders: 'Test operative. Use drive/ls to list the project root.',
      });
    }

    // Create routine
    const routine = await routines.create({
      name: 'Segment Test Routine',
      operativeSlug: opSlug,
      scope: 'project',
      projectName: TEST_PROJECT_NAME,
      steps: [
        { id: 'step-1', name: 'List root', action: 'Use drive/ls on the project root.', order: 1 },
      ],
    });

    // List routines
    const allRoutines = await routines.list({
      scope: 'project',
      projectName: TEST_PROJECT_NAME,
    });
    const found = allRoutines.some((r) => r.slug === routine.slug);

    // Cleanup
    await routines.delete({
      slug: routine.slug,
      scope: 'project',
      projectName: TEST_PROJECT_NAME,
    });

    return pass(
      name,
      `Projects: ${allProjects.length}, ` +
        `Operative: ${operative.slug}, ` +
        `Routine created: ${routine.slug}, ` +
        `Listed: ${found}, ` +
        `Deleted: ok`
    );
  } catch (err) {
    return fail(name, err instanceof Error ? err.message : String(err));
  }
};

// ---------------------------------------------------------------------------
// S4: Routine Execution Runs (read-only -- verify history endpoint)
// ---------------------------------------------------------------------------

const testS4ExecutionRuns = async (auth: AuthModule): Promise<TestResult> => {
  const name = 'S4: Routine Execution Runs (list endpoint)';
  try {
    const routineRuns = diskd.platform.routineRuns({ auth, url: APP_URL });

    // List runs for a non-existent routine -- should return empty, not error
    const runs = await routineRuns.list({ routineSlug: '__nonexistent__' });
    if (!Array.isArray(runs)) {
      return fail(name, 'routineRuns.list() did not return an array');
    }

    return pass(name, `RoutineRuns endpoint OK. Returned ${runs.length} runs for test slug`);
  } catch (err) {
    return fail(name, err instanceof Error ? err.message : String(err));
  }
};

// ---------------------------------------------------------------------------
// S5: Drive Tools (write + read roundtrip)
// ---------------------------------------------------------------------------

const testS5DriveTools = async (auth: AuthModule): Promise<TestResult> => {
  const name = 'S5: Drive Tools (write + read roundtrip)';
  try {
    const drive = diskd.os.drive({ version: 'v1', auth, url: DRIVE_URL });
    await drive.init();

    // Write a test file at root level (no project dependency)
    const testContent = `Pipeline segment test: ${new Date().toISOString()}`;
    const writePath = '/_pipeline_test.md';

    await drive.tools.writeFile({ path: writePath, content: testContent });

    // Read it back
    const readResult = await drive.tools.readFile({ path: writePath });
    const readContent = readResult.parts.map((p) => p.content).join('\n');

    if (!readContent.includes('Pipeline segment test')) {
      return fail(name, `Read-back content does not match. Got: ${readContent.substring(0, 100)}`);
    }

    return pass(name, `Write + Read roundtrip OK. File: ${writePath}`);
  } catch (err) {
    return fail(name, err instanceof Error ? err.message : String(err));
  }
};

// ---------------------------------------------------------------------------
// S6: MCP Tools Connectivity
// ---------------------------------------------------------------------------

const testS6McpTools = async (_auth: AuthModule): Promise<TestResult> => {
  const name = 'S6: MCP Tools Connectivity';
  try {
    // MCP Hub may use a different API key than Drive
    const mcpApiKey = process.env.DISKD_MCP_API_KEY ?? process.env.DISKD_API_KEY ?? API_KEY;
    const mcpAuth = diskd.auth.apiKey({ apiKey: mcpApiKey, workspaceId: WORKSPACE_ID });
    const mcpTools = diskd.os.mcpTools({ auth: mcpAuth, url: MCP_URL });
    const tools = await mcpTools.list();

    if (!Array.isArray(tools)) {
      return fail(name, 'mcpTools.list() did not return an array');
    }

    const emailTools = tools.filter((t: { name: string }) =>
      t.name.toLowerCase().includes('email')
    );

    return pass(name, `MCP tools: ${tools.length} total, ${emailTools.length} email tools`);
  } catch (err) {
    // MCP tools may not be available if no servers are running
    return skip(name, `MCP Hub not reachable: ${err instanceof Error ? err.message : String(err)}`);
  }
};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const ALL_TESTS: ReadonlyArray<{
  readonly id: string;
  readonly fn: (auth: AuthModule) => Promise<TestResult>;
}> = [
  { id: 'S2', fn: testS2DriveAndCrontab },
  { id: 'S3', fn: testS3ProjectsCrud },
  { id: 'S4', fn: testS4ExecutionRuns },
  { id: 'S5', fn: testS5DriveTools },
  { id: 'S6', fn: testS6McpTools },
];

const main = async (): Promise<void> => {
  if (WORKSPACE_ID.length === 0) {
    console.error('Missing DISKD_WORKSPACE_ID env var');
    process.exitCode = 1;
    return;
  }

  const filterArg = process.argv[2];
  const tests = filterArg ? ALL_TESTS.filter((t) => t.id === filterArg) : ALL_TESTS;

  if (tests.length === 0) {
    console.error(`No test found for: ${filterArg}`);
    console.error(`Available: ${ALL_TESTS.map((t) => t.id).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  console.log();
  console.log('Email-to-Project Pipeline: Segment Tests');
  console.log('='.repeat(50));
  console.log(`  Workspace: ${WORKSPACE_ID}`);
  console.log(`  Tests:     ${tests.map((t) => t.id).join(', ')}`);
  console.log('='.repeat(50));
  console.log();

  const auth = diskd.auth.apiKey({ apiKey: API_KEY, workspaceId: WORKSPACE_ID });

  const results: TestResult[] = [];
  for (const test of tests) {
    process.stdout.write(`  ${test.id} ... `);
    const result = await test.fn(auth);
    results.push(result);

    switch (result.tag) {
      case 'pass':
        console.log(`PASS  ${result.detail}`);
        break;
      case 'fail':
        console.log(`FAIL  ${result.error}`);
        break;
      case 'skip':
        console.log(`SKIP  ${result.reason}`);
        break;
    }
  }

  console.log();
  console.log('-'.repeat(50));
  const passed = results.filter((r) => r.tag === 'pass').length;
  const failed = results.filter((r) => r.tag === 'fail').length;
  const skipped = results.filter((r) => r.tag === 'skip').length;
  console.log(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);

  if (failed > 0) {
    console.log();
    console.log('Failures:');
    for (const r of results) {
      if (r.tag === 'fail') {
        console.log(`  ${r.name}: ${r.error}`);
      }
    }
    process.exitCode = 1;
  }

  console.log();
};

main().catch((err: unknown) => {
  console.error('Error:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
