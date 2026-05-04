/**
 * MCP Hub SDK -- internal service example
 *
 * Demonstrates catalog browsing, registry management, tool toggling, and log
 * retrieval using the diskd.os.mcp() factory with API key auth.
 *
 * Environment:
 *   APIS_BASE_URL    - APIS gateway URL (default: https://apis.diskd.local:8080)
 *   APIS_API_KEY     - Gateway API key (default: key-dev-1234567890)
 *   WORKSPACE_ID     - Workspace ID (default: dev-user-id)
 *
 * Run:
 *   npm run examples:build && node dist-examples/node/mcp-hub-example.js
 */

import { diskd } from '../../src/sdk/diskd.js';

// ---------------------------------------------------------------------------
// Configuration from environment
// ---------------------------------------------------------------------------

const APIS_BASE_URL = (process.env.APIS_BASE_URL ?? 'https://apis.diskd.local:8080').replace(
  /\/+$/,
  ''
);
const APIS_API_KEY = process.env.APIS_API_KEY ?? 'key-dev-1234567890';
const WORKSPACE_ID = process.env.WORKSPACE_ID ?? 'dev-user-id';
process.env.APIS_BASE_URL = APIS_BASE_URL;
process.env.APIS_API_KEY = APIS_API_KEY;

// ---------------------------------------------------------------------------
// Create MCP Hub client via diskd factory (internal service pattern)
// ---------------------------------------------------------------------------

const auth = diskd.auth.apiKey({ workspaceId: WORKSPACE_ID });

const mcpHub = diskd.os.mcp({ auth, workspaceId: WORKSPACE_ID });

console.log(`Connecting to APIS gateway at ${APIS_BASE_URL}`);
console.log(`Workspace: ${WORKSPACE_ID}\n`);

// ---------------------------------------------------------------------------
// 1. List catalog -- search for available MCP servers
// ---------------------------------------------------------------------------

console.log('=== 1. List catalog (search for servers) ===');

const catalogResult = await mcpHub.catalog.list({ pageSize: 5 });

console.log(`[ok] Catalog total: ${catalogResult.total} server(s)`);
const sample = catalogResult.items.slice(0, 3);
for (const server of sample) {
  console.log(`     ${server.id} -- "${server.name}" (${server.category})`);
}

// Keep track of the first catalog server for later steps
const catalogServer = catalogResult.items[0];

// ---------------------------------------------------------------------------
// 2. Get server details from catalog
// ---------------------------------------------------------------------------

if (catalogServer) {
  console.log(`\n=== 2. Get catalog server details: ${catalogServer.id} ===`);

  const details = await mcpHub.catalog.getServerDetails(catalogServer.id);

  console.log(`[ok] Server: ${details.name}`);
  console.log(`     Description: ${details.description.slice(0, 80)}`);
  console.log(`     Tools: ${details.tools.length}`);
  for (const tool of details.tools.slice(0, 3)) {
    console.log(`       - ${tool.name}: ${tool.description.slice(0, 60)}`);
  }
  if (details.tools.length > 3) {
    console.log(`       ... and ${details.tools.length - 3} more`);
  }
} else {
  console.log('\n=== 2. Get catalog server details ===');
  console.log('[skip] No servers found in catalog');
}

// ---------------------------------------------------------------------------
// 3. List registry -- installed servers in this workspace
// ---------------------------------------------------------------------------

console.log('\n=== 3. List registry (installed servers) ===');

const registryResult = await mcpHub.registry.list();

console.log(`[ok] Registry: ${registryResult.items.length} server(s) installed`);
for (const s of registryResult.items) {
  const label = s.alias ?? s.catalogServerId ?? s.id;
  console.log(`     ${s.id} -- "${label}" status=${s.status}`);
}

// ---------------------------------------------------------------------------
// 4. Add a server from catalog (only if catalog has a server and
//    it is not already in the registry)
// ---------------------------------------------------------------------------

let installedServerId: string | null = null;

if (catalogServer) {
  const alreadyInstalled = registryResult.items.some((s) => s.catalogServerId === catalogServer.id);

  if (!alreadyInstalled) {
    console.log(`\n=== 4. Add server from catalog: ${catalogServer.id} ===`);

    const addResult = await mcpHub.registry.addServer({
      catalogServerId: catalogServer.id,
    });

    if ('server' in addResult) {
      installedServerId = addResult.server.id;
      console.log(
        `[ok] Installed server: ${addResult.server.id} (status=${addResult.server.status})`
      );
    } else {
      console.log(`[ok] Operation started: ${addResult.operationId}`);
    }
  } else {
    const existing = registryResult.items.find((s) => s.catalogServerId === catalogServer.id);
    installedServerId = existing?.id ?? null;
    console.log(`\n=== 4. Add server from catalog ===`);
    console.log(`[skip] Server already installed as ${installedServerId}`);
  }
} else {
  console.log('\n=== 4. Add server from catalog ===');
  console.log('[skip] No catalog server available');
  installedServerId = registryResult.items[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// 5. Toggle a tool -- disable then re-enable the first tool of the server
// ---------------------------------------------------------------------------

console.log('\n=== 5. Toggle a tool ===');

if (installedServerId) {
  // Refresh registry to see current tools
  const registryRefresh = await mcpHub.registry.list();
  const target = registryRefresh.items.find((s) => s.id === installedServerId);
  const firstTool = target?.tools[0];

  if (firstTool) {
    // Disable the tool
    await mcpHub.registry.toggleTool(installedServerId, firstTool.id, false);
    console.log(`[ok] Disabled tool: ${firstTool.name} (id=${firstTool.id})`);

    // Re-enable the tool
    await mcpHub.registry.toggleTool(installedServerId, firstTool.id, true);
    console.log(`[ok] Re-enabled tool: ${firstTool.name}`);
  } else {
    console.log(`[skip] Server ${installedServerId} has no tools (or server not fully started)`);
  }
} else {
  console.log('[skip] No installed server available');
}

// ---------------------------------------------------------------------------
// 6. List server logs
// ---------------------------------------------------------------------------

console.log('\n=== 6. List server logs ===');

if (installedServerId) {
  const logsResult = await mcpHub.registry.getServerLogs(installedServerId, { limit: 10 });

  console.log(`[ok] Log entries: ${logsResult.logs.length}`);
  for (const entry of logsResult.logs.slice(0, 3)) {
    console.log(`     [${entry.level}] ${entry.timestamp} ${entry.message.slice(0, 80)}`);
  }
  if (logsResult.logs.length === 0) {
    console.log('     (no log entries yet -- server may not have started)');
  }
} else {
  console.log('[skip] No installed server available');
}

// ---------------------------------------------------------------------------
// 7. Delete the server we just installed (cleanup)
// ---------------------------------------------------------------------------

console.log('\n=== 7. Delete server ===');

if (installedServerId && catalogServer) {
  // Only delete if we actually added it in step 4
  const wasAdded = !registryResult.items.some((s) => s.catalogServerId === catalogServer.id);
  if (wasAdded) {
    await mcpHub.registry.deleteServer(installedServerId);
    console.log(`[ok] Deleted server ${installedServerId}`);
  } else {
    console.log(`[skip] Preserving pre-existing server ${installedServerId}`);
  }
} else {
  console.log('[skip] Nothing to delete');
}

console.log('\n[done] All MCP Hub operations completed successfully');
