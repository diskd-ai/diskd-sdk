export const getLocation = () => {
    const locationObj = globalThis.location;
    if (!locationObj) {
        throw new Error('location is unavailable');
    }
    return locationObj;
};
export const replaceUrlWithoutSearchParams = () => {
    const historyObj = globalThis.history;
    const locationObj = globalThis.location;
    if (!historyObj || !locationObj)
        return;
    const current = new URL(locationObj.href);
    const clean = `${current.origin}${current.pathname}${current.hash}`;
    historyObj.replaceState({}, '', clean);
};
