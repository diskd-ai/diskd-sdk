export const getSessionStorage = () => {
    const storage = globalThis.sessionStorage;
    if (!storage) {
        throw new Error('sessionStorage is unavailable');
    }
    return storage;
};
