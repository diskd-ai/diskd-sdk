/* REQ-DRIVE-UPLOAD-002: Large multi-chunk proxy streams preserve Content-Length
 * under the Bun runtime used by app-service. */

import assert from 'node:assert/strict';
import { type IncomingMessage, request as httpRequest, type ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import type { AuthModule } from '../src/auth/types.js';
import { diskd } from '../src/sdk/diskd.js';

const uploadSize = 586_817;
let receivedContentLength: string | undefined;
let receivedBodySize = 0;

/** Read a complete request body for the local Drive contract fixture. */
const readBody = async (request: IncomingMessage): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

/** Return one JSON response from the local Drive contract fixture. */
const respondJson = (response: ServerResponse, statusCode: number, body: unknown): void => {
  response.writeHead(statusCode, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
};

/** Exercise the public SDK through the same delayed incoming stream shape as app-service. */
const handleIngress = async (
  request: IncomingMessage,
  response: ServerResponse,
  port: number
): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, 100));
  const auth: AuthModule = {
    signIn: async () => {},
    signOut: () => {},
    handleRedirectCallback: async () => {},
    getAccessToken: async () => 'unused-token',
    getRequestHeaders: async () => ({ 'X-Api-Key': 'drive-key' }),
    getToken: () => ({ accessToken: 'unused-token' }),
    getWorkspaceId: async () => 'test-workspace',
  };
  const drive = diskd.os.drive({
    version: 'v1',
    auth,
    url: `http://127.0.0.1:${port}/api/v1`,
  });
  const result = await drive.upload.file({
    name: 'large-upload.png',
    stream: Readable.toWeb(request) as ReadableStream<Uint8Array>,
    size: uploadSize,
    sha256Root: 'sha256-large-upload',
    mimeType: 'image/png',
  });
  respondJson(response, 200, result);
};

/** Implement the minimum start, transfer, and commit contract needed by the regression. */
const handleDriveContract = async (
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> => {
  if (request.url === '/api/v1/drive/upload') {
    receivedContentLength = request.headers['content-length'];
    receivedBodySize = (await readBody(request)).byteLength;
    if (!receivedContentLength) {
      respondJson(response, 411, { error: 'Content-Length header is required for uploads' });
      return;
    }
    respondJson(response, 200, { etag: 'etag-large-upload' });
    return;
  }

  const body = JSON.parse((await readBody(request)).toString('utf8')) as {
    readonly id: number;
    readonly method: string;
  };
  const result = body.method === 'drive/upload/start'
    ? {
        intent_id: 'intent-large-upload',
        inode: 'inode-large-upload',
        upload_url: '/api/v1/drive/upload',
        expires_in: 900,
        multipart: false,
      }
    : {
        inode: 'inode-large-upload',
        etag: 'etag-large-upload',
        version: 1,
        committed_at: '2026-08-29T00:00:00Z',
      };
  respondJson(response, 200, { jsonrpc: '2.0', result, id: body.id });
};

/** Send the representative upload in multiple chunks to reproduce proxy backpressure. */
const sendRepresentativeUpload = async (port: number): Promise<number> =>
  new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      `http://127.0.0.1:${port}/ingress`,
      {
        method: 'PUT',
        headers: { 'Content-Length': String(uploadSize), 'Content-Type': 'image/png' },
      },
      async (response) => {
        response.on('error', reject);
        try {
          await readBody(response);
          resolve(response.statusCode ?? 0);
        } catch (error) {
          reject(error);
        }
      }
    );
    outgoing.on('error', reject);
    const payload = Buffer.alloc(uploadSize, 1);
    for (let offset = 0; offset < payload.byteLength; offset += 64 * 1024) {
      outgoing.write(payload.subarray(offset, Math.min(offset + 64 * 1024, payload.byteLength)));
    }
    outgoing.end();
  });

const server = createServer((request, response) => {
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const handler = request.url === '/ingress'
    ? handleIngress(request, response, address.port)
    : handleDriveContract(request, response);
  handler.catch((error: unknown) => {
    console.error('Bun upload regression fixture failed', error);
    if (!response.headersSent) {
      respondJson(response, 500, { error: String(error) });
      return;
    }
    response.destroy(error instanceof Error ? error : new Error(String(error)));
  });
});

try {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  const statusCode = await sendRepresentativeUpload(address.port);

  assert.equal(statusCode, 200);
  assert.equal(receivedContentLength, String(uploadSize));
  assert.equal(receivedBodySize, uploadSize);
  console.log('Bun upload regression passed');
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
