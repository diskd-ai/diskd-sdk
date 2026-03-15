type SessionStorageLike = {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
  readonly removeItem: (key: string) => void;
};

export const getSessionStorage = (): SessionStorageLike => {
  const storage = (globalThis as { sessionStorage?: SessionStorageLike }).sessionStorage;
  if (!storage) {
    throw new Error('sessionStorage is unavailable');
  }
  return storage;
};
