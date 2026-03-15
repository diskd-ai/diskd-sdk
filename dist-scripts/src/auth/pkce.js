const getCrypto = () => {
    const cryptoObj = globalThis.crypto;
    if (!cryptoObj || typeof cryptoObj !== 'object') {
        throw new Error('Web Crypto is unavailable');
    }
    const cryptoLike = cryptoObj;
    if (typeof cryptoLike.getRandomValues !== 'function' || !cryptoLike.subtle) {
        throw new Error('Web Crypto is unavailable');
    }
    return cryptoLike;
};
const toBase64Url = (bytes) => {
    const base64 = (() => {
        if (typeof Buffer !== 'undefined') {
            return Buffer.from(bytes).toString('base64');
        }
        const btoaFn = globalThis.btoa;
        if (!btoaFn) {
            throw new Error('btoa is unavailable');
        }
        return btoaFn(String.fromCharCode(...bytes));
    })();
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};
const utf8Encode = (value) => new TextEncoder().encode(value);
export const createPkceVerifier = () => {
    const cryptoLike = getCrypto();
    const bytes = new Uint8Array(32);
    cryptoLike.getRandomValues(bytes);
    return toBase64Url(bytes);
};
export const createPkceState = () => {
    const cryptoLike = getCrypto();
    const bytes = new Uint8Array(16);
    cryptoLike.getRandomValues(bytes);
    return toBase64Url(bytes);
};
export const createPkceChallenge = async (verifier) => {
    const cryptoLike = getCrypto();
    const digest = await cryptoLike.subtle.digest('SHA-256', utf8Encode(verifier));
    return toBase64Url(new Uint8Array(digest));
};
