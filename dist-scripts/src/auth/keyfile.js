const isObject = (value) => typeof value === 'object' && value !== null;
const readRequiredString = (obj, key) => {
    const value = obj[key];
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`Invalid credentials.json: '${key}' must be a non-empty string`);
    }
    return value;
};
export const readKeyfileFromPath = async (keyfilePath) => {
    const fs = await import('node:fs/promises');
    const rawText = await fs.readFile(keyfilePath, 'utf-8');
    const data = JSON.parse(rawText);
    if (!isObject(data)) {
        throw new Error('Invalid credentials.json: expected object');
    }
    return {
        issuer: readRequiredString(data, 'issuer'),
        clientId: readRequiredString(data, 'clientId'),
        clientSecret: readRequiredString(data, 'clientSecret'),
        audience: readRequiredString(data, 'audience'),
    };
};
