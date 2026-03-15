type LocationLike = { href: string };
type HistoryLike = {
  replaceState: (data: unknown, title: string, url?: string | URL | null) => void;
};

export const getLocation = (): LocationLike => {
  const locationObj = (globalThis as { location?: LocationLike }).location;
  if (!locationObj) {
    throw new Error('location is unavailable');
  }
  return locationObj;
};

export const replaceUrlWithoutSearchParams = (): void => {
  const historyObj = (globalThis as { history?: HistoryLike }).history;
  const locationObj = (globalThis as { location?: LocationLike }).location;
  if (!historyObj || !locationObj) return;

  const current = new URL(locationObj.href);
  const clean = `${current.origin}${current.pathname}${current.hash}`;
  historyObj.replaceState({}, '', clean);
};
