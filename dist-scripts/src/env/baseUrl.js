const readEnvString = (value) => typeof value === 'string' && value.length > 0 ? value : undefined;
const stripTrailingSlashes = (value) => value.replace(/\/+$/, '');
const stripSurroundingSlashes = (value) => value.replace(/^\/+|\/+$/g, '');
export const resolveDiskdBaseUrl = () => {
    const nodeEnv = readEnvString(globalThis.process?.env?.DISKD_BASE_URL);
    if (nodeEnv)
        return nodeEnv;
    const runtime = readEnvString(globalThis.DISKD_BASE_URL);
    if (runtime)
        return runtime;
    return 'https://apis.diskd.local:8080';
};
export const resolveDiskdGatewayUrl = (pathPrefix) => {
    const normalizedPrefix = stripSurroundingSlashes(pathPrefix);
    const baseUrl = stripTrailingSlashes(resolveDiskdBaseUrl());
    return normalizedPrefix.length > 0 ? `${baseUrl}/${normalizedPrefix}` : baseUrl;
};
