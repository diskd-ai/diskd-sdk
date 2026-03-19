// Auth stubs

// Re-export auth types commonly needed in tests
export type { AuthModule, AuthToken } from '../auth/types.js';
export type { MakeAuthOptions } from './auth.js';
export { makeAuth } from './auth.js';
export type { FetchCall, FetchHandler } from './fetchMock.js';
// Fetch mock utilities
export { withEnv, withFetchMock } from './fetchMock.js';
export type { ApiKeyCheck, ApiKeyEnv, IntegrationCheck, IntegrationEnv } from './integration.js';
// Integration test helpers
export { checkApiKeyEnv, checkIntegrationEnv } from './integration.js';
// JSON-RPC response builders
export { jsonResponse, jsonRpcError, jsonRpcResponse, parseBody } from './jsonRpc.js';
export type { RpcCall, RpcMock } from './rpcMock.js';
// RPC mock utilities
export { makeRpcMock, makeRpcSequenceMock } from './rpcMock.js';
