/* REQ-3680-008: drive.tools.excelSetCells and excelReadCells carry Drive's paths/tools/excel-set-cells and excel-read-cells contract (owner-locked 2026-11-12). */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthModule } from '../auth/types.js';
import { diskd } from '../sdk/diskd.js';

type FetchCall = { readonly url: string; readonly init?: RequestInit };

const auth: AuthModule = {
  signIn: async () => {},
  signOut: () => {},
  handleRedirectCallback: async () => {},
  getAccessToken: async () => 'token-3680',
  getToken: () => ({ accessToken: 'token-3680' }),
  getWorkspaceId: async () => 'workspace-3680',
};

/** Answer each JSON-RPC call with the next body and record what was sent. */
const withDrive = async (
  answers: readonly unknown[],
  fn: (drive: ReturnType<typeof diskd.os.drive>, calls: FetchCall[]) => Promise<void>
): Promise<void> => {
  process.env.APIS_BASE_URL = 'https://apis.example';
  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  (globalThis as { fetch: typeof fetch }).fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    calls.push({ url: input.toString(), init });
    return new Response(JSON.stringify(answers[calls.length - 1]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    await fn(diskd.os.drive({ version: 'v1', auth }), calls);
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    delete process.env.APIS_BASE_URL;
  }
};

const sent = (call: FetchCall | undefined) => JSON.parse(String(call?.init?.body));

test('excelSetCells sends paths/tools/excel-set-cells with cells and expected and returns the new etag', async () => {
  await withDrive(
    [
      {
        jsonrpc: '2.0',
        id: 1,
        result: {
          success: true,
          inode: 'inode-1',
          path: '/case/products.xlsx',
          etag: 'e2',
          sheet: 'Products',
          cells_written: 2,
        },
      },
    ],
    async (drive, calls) => {
      const result = await drive.tools.excelSetCells({
        path: '/case/products.xlsx',
        sheet: 'Products',
        cells: [
          { cell: 'G2', value: 120, bgcolor: null },
          { cell: 'O2', value: 'estimate', bgcolor: 'FFF2CC' },
        ],
        expected: [{ cell: 'B2', value: 637723 }],
      });
      const body = sent(calls[0]);
      assert.equal(body.method, 'paths/tools/excel-set-cells');
      assert.deepEqual(body.params, {
        path: '/case/products.xlsx',
        sheet: 'Products',
        cells: [
          { cell: 'G2', value: 120, bgcolor: null },
          { cell: 'O2', value: 'estimate', bgcolor: 'FFF2CC' },
        ],
        expected: [{ cell: 'B2', value: 637723 }],
      });
      assert.deepEqual(result, {
        id: 'inode-1',
        path: '/case/products.xlsx',
        etag: 'e2',
        sheet: 'Products',
        cellsWritten: 2,
      });
    }
  );
});

test('excelSetCells without expected sends no expected field', async () => {
  await withDrive(
    [
      {
        jsonrpc: '2.0',
        id: 1,
        result: {
          success: true,
          inode: 'i',
          path: '/a.xlsx',
          etag: 'e',
          sheet: 'S',
          cells_written: 1,
        },
      },
    ],
    async (drive, calls) => {
      await drive.tools.excelSetCells({
        path: '/a.xlsx',
        sheet: 'S',
        cells: [{ cell: 'A1', value: null, bgcolor: null }],
      });
      assert.equal('expected' in sent(calls[0]).params, false);
    }
  );
});

test('excelReadCells sends paths/tools/excel-read-cells and decodes every cell', async () => {
  await withDrive(
    [
      {
        jsonrpc: '2.0',
        id: 1,
        result: {
          inode: 'inode-1',
          path: '/case/products.xlsx',
          etag: 'e7',
          sheet: 'Products',
          cells: [
            { cell: 'A2', value: 1, bgcolor: null },
            { cell: 'B2', value: 'x', bgcolor: 'FFF2CC' },
            { cell: 'C2', value: true, bgcolor: null },
            { cell: 'D2', value: null, bgcolor: null },
          ],
        },
      },
    ],
    async (drive, calls) => {
      const result = await drive.tools.excelReadCells({
        path: '/case/products.xlsx',
        sheet: 'Products',
        cells: ['A2:D2'],
      });
      const body = sent(calls[0]);
      assert.equal(body.method, 'paths/tools/excel-read-cells');
      assert.deepEqual(body.params, {
        path: '/case/products.xlsx',
        sheet: 'Products',
        cells: ['A2:D2'],
      });
      assert.deepEqual(result, {
        id: 'inode-1',
        path: '/case/products.xlsx',
        etag: 'e7',
        sheet: 'Products',
        cells: [
          { cell: 'A2', value: 1, bgcolor: null },
          { cell: 'B2', value: 'x', bgcolor: 'FFF2CC' },
          { cell: 'C2', value: true, bgcolor: null },
          { cell: 'D2', value: null, bgcolor: null },
        ],
      });
    }
  );
});

test('excelReadCells refuses a malformed cell in the response', async () => {
  await withDrive(
    [
      {
        jsonrpc: '2.0',
        id: 1,
        result: {
          inode: 'i',
          path: '/a.xlsx',
          etag: null,
          sheet: 'S',
          cells: [{ cell: 'A1', value: { nested: 1 }, bgcolor: null }],
        },
      },
    ],
    async (drive) => {
      await assert.rejects(
        drive.tools.excelReadCells({ path: '/a.xlsx', sheet: 'S', cells: ['A1'] }),
        /Invalid Drive response/
      );
    }
  );
});

test('a busy workbook surfaces the Drive error code', async () => {
  await withDrive(
    [
      {
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32009,
          message: "excel-set-cells failed for '/a.xlsx': busy",
          data: { domain_code: 'FILE_BUSY', details: { inode: 'i', waited_seconds: 120 } },
        },
      },
    ],
    async (drive) => {
      await assert.rejects(
        drive.tools.excelSetCells({
          path: '/a.xlsx',
          sheet: 'S',
          cells: [{ cell: 'A1', value: 1, bgcolor: null }],
        }),
        (error: unknown) =>
          JSON.stringify(error).includes('FILE_BUSY') || String(error).includes('busy')
      );
    }
  );
});
