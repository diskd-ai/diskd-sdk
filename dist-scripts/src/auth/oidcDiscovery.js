const isObject = (value) => typeof value === 'object' && value !== null;
const readRequiredString = (obj, key) => {
    const value = obj[key];
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`Invalid discovery document: '${key}' must be a non-empty string`);
    }
    return value;
};
const readOptionalString = (obj, key) => {
    const value = obj[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
};
export const fetchOidcDiscovery = async (issuer) => {
    const url = `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`;
    const response = await fetch(url);
    const data = await response.json();
    if (!isObject(data)) {
        throw new Error('Invalid discovery document: expected object');
    }
    return {
        issuer: readRequiredString(data, 'issuer'),
        authorization_endpoint: readRequiredString(data, 'authorization_endpoint'),
        token_endpoint: readRequiredString(data, 'token_endpoint'),
        userinfo_endpoint: readOptionalString(data, 'userinfo_endpoint'),
    };
};
