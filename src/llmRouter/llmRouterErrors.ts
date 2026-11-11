/** Safe machine facts advertised by the router; message is display-only. */
export type LlmRouterErrorData = {
  readonly reason?: string;
  readonly status?: number;
  readonly type?: string;
  readonly code?: string | number;
  readonly param?: string;
  readonly message?: string;
};

type LlmRouterErrorDetails = {
  readonly rpcCode?: number;
  readonly httpStatus?: number;
  readonly data: LlmRouterErrorData;
};

/** Router failure; callers classify codes and data, never the display message. */
export class LlmRouterError extends Error {
  readonly rpcCode?: number;
  readonly httpStatus?: number;
  readonly data: LlmRouterErrorData;

  constructor(message: string, details: LlmRouterErrorDetails) {
    super(message);
    this.name = 'LlmRouterError';
    this.rpcCode = details.rpcCode;
    this.httpStatus = details.httpStatus;
    this.data = details.data;
  }
}

/** Compatible context-overflow error, also carrying the common router facts. */
export class ContextTooLargeError extends LlmRouterError {
  readonly reason = 'context_too_large';

  constructor(message: string, details?: LlmRouterErrorDetails) {
    super(message, { ...details, data: { ...details?.data, reason: 'context_too_large' } });
    this.name = 'ContextTooLargeError';
  }
}

type RawErrorData = { readonly [key: string]: unknown };
const _isObject = (value: unknown): value is RawErrorData =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const _object = (value: unknown): RawErrorData => (_isObject(value) ? value : {});
const _own = (data: RawErrorData, key: string): unknown =>
  Object.hasOwn(data, key) ? data[key] : undefined;
const _identifier = (data: RawErrorData, key: string): string | undefined => {
  const value = _own(data, key);
  return typeof value === 'string' && /^[A-Za-z0-9_.:[\]-]{1,128}$/.test(value) ? value : undefined;
};

/** Decode only the agreed DTO. Provider payloads and unknown fields stay private. */
export const decodeLlmRouterErrorData = (value: unknown): LlmRouterErrorData => {
  const data = _object(value);
  const reason = _identifier(data, 'reason');
  const status = _own(data, 'status');
  const type = _identifier(data, 'type');
  const rawCode = _own(data, 'code');
  const code = typeof rawCode === 'string' ? _identifier(data, 'code') : rawCode;
  const param = _identifier(data, 'param');
  const rawMessage = _own(data, 'message');
  const message =
    typeof rawMessage === 'string' && rawMessage.length <= 1000 ? rawMessage : undefined;
  return {
    ...(reason !== undefined ? { reason } : {}),
    ...(typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
      ? { status }
      : {}),
    ...(type !== undefined ? { type } : {}),
    ...(typeof code === 'string' || (typeof code === 'number' && Number.isFinite(code))
      ? { code }
      : {}),
    ...(param !== undefined ? { param } : {}),
    ...(message !== undefined ? { message } : {}),
  };
};

export const makeLlmRouterError = (
  message: string,
  httpStatus: number,
  code: unknown,
  rawData: unknown,
  legacyCode?: unknown
): LlmRouterError => {
  const decoded = decodeLlmRouterErrorData(rawData);
  // The old stream-start endpoint explicitly advertised this code before data existed.
  const data =
    decoded.reason === undefined && legacyCode === 'context_too_large'
      ? { ...decoded, reason: 'context_too_large' }
      : decoded;
  const details = {
    httpStatus,
    ...(typeof code === 'number' && Number.isSafeInteger(code) ? { rpcCode: code } : {}),
    data,
  };
  return data.reason === 'context_too_large'
    ? new ContextTooLargeError(message, details)
    : new LlmRouterError(message, details);
};
