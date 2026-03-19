export type RpcCall = {
  readonly method: string;
  readonly params: unknown;
};

export type RpcMock = {
  readonly calls: RpcCall[];
  readonly call: (method: string, params: unknown) => Promise<unknown>;
};

/** Create an RPC mock that always returns the same response. */
export const makeRpcMock = (response: unknown): RpcMock => {
  const calls: RpcCall[] = [];
  const call = async (method: string, params: unknown): Promise<unknown> => {
    calls.push({ method, params });
    return response;
  };
  return { calls, call };
};

/**
 * Create an RPC mock that returns responses in sequence.
 * If a response is an Error instance, it will be thrown.
 */
export const makeRpcSequenceMock = (responses: readonly unknown[]): RpcMock => {
  const calls: RpcCall[] = [];
  let index = 0;
  const call = async (method: string, params: unknown): Promise<unknown> => {
    calls.push({ method, params });
    const response = responses[index];
    index += 1;
    if (response instanceof Error) {
      throw response;
    }
    return response;
  };
  return { calls, call };
};
