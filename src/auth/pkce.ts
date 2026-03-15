type WebCryptoLike = {
  readonly getRandomValues: (array: Uint8Array) => Uint8Array;
  readonly subtle: {
    readonly digest: (
      algorithm: string,
      data: ArrayBuffer | ArrayBufferView
    ) => Promise<ArrayBuffer>;
  };
};

const getCrypto = (): WebCryptoLike => {
  const cryptoObj = (globalThis as { crypto?: unknown }).crypto;
  if (!cryptoObj || typeof cryptoObj !== 'object') {
    throw new Error('Web Crypto is unavailable');
  }
  const cryptoLike = cryptoObj as Partial<WebCryptoLike>;
  if (typeof cryptoLike.getRandomValues !== 'function' || !cryptoLike.subtle) {
    throw new Error('Web Crypto is unavailable');
  }
  return cryptoLike as WebCryptoLike;
};

const toBase64Url = (bytes: Uint8Array): string => {
  const base64 = (() => {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(bytes).toString('base64');
    }
    const btoaFn = (globalThis as { btoa?: (data: string) => string }).btoa;
    if (!btoaFn) {
      throw new Error('btoa is unavailable');
    }
    return btoaFn(String.fromCharCode(...bytes));
  })();
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const utf8Encode = (value: string): Uint8Array => new TextEncoder().encode(value);

export const createPkceVerifier = (): string => {
  const cryptoLike = getCrypto();
  const bytes = new Uint8Array(32);
  cryptoLike.getRandomValues(bytes);
  return toBase64Url(bytes);
};

export const createPkceState = (): string => {
  const cryptoLike = getCrypto();
  const bytes = new Uint8Array(16);
  cryptoLike.getRandomValues(bytes);
  return toBase64Url(bytes);
};

export const createPkceChallenge = async (verifier: string): Promise<string> => {
  const cryptoLike = getCrypto();
  const digest = await cryptoLike.subtle.digest('SHA-256', utf8Encode(verifier));
  return toBase64Url(new Uint8Array(digest));
};
