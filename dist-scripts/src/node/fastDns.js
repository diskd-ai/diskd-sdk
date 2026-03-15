import dns from 'node:dns';
import fs from 'node:fs';
import { Agent, setGlobalDispatcher } from 'undici';
import { resolveDiskdBaseUrl } from '../env/baseUrl.js';
const parseHostsFile = (raw) => {
    const map = new Map();
    for (const lineRaw of raw.split(/\r?\n/u)) {
        const line = lineRaw.trim();
        if (line.length === 0 || line.startsWith('#'))
            continue;
        const parts = line.split(/\s+/u).filter((part) => part.length > 0);
        const ip = parts[0];
        if (!ip)
            continue;
        for (const host of parts.slice(1)) {
            const normalized = host.trim().toLowerCase();
            if (normalized.length === 0)
                continue;
            if (!map.has(normalized)) {
                map.set(normalized, ip);
            }
        }
    }
    return map;
};
const readHostsMap = () => {
    const content = fs.readFileSync('/etc/hosts', 'utf8');
    return parseHostsFile(content);
};
const hasAll = (options) => typeof options === 'object' &&
    options !== null &&
    options.all === true;
const readFamily = (options) => {
    if (typeof options === 'number')
        return options;
    if (typeof options !== 'object' || options === null)
        return undefined;
    const family = options.family;
    return typeof family === 'number' ? family : undefined;
};
const callFallbackLookup = (hostname, options, callback) => {
    if (typeof options === 'function') {
        dns.lookup(hostname, options);
        return;
    }
    if (typeof callback !== 'function')
        return;
    if (options === undefined) {
        dns.lookup(hostname, callback);
        return;
    }
    if (typeof options === 'number') {
        dns.lookup(hostname, options, callback);
        return;
    }
    if (hasAll(options)) {
        dns.lookup(hostname, options, callback);
        return;
    }
    dns.lookup(hostname, options, callback);
};
const createHostsLookup = (map) => {
    const lookupImpl = (...args) => {
        const hostnameRaw = args[0];
        if (typeof hostnameRaw !== 'string')
            return;
        const hostname = hostnameRaw.toLowerCase();
        const options = args[1];
        const callback = args[2] ?? args[1];
        const mapped = map.get(hostname);
        if (!mapped) {
            callFallbackLookup(hostnameRaw, options, callback);
            return;
        }
        const family = mapped.includes(':') ? 6 : 4;
        const requestedFamily = readFamily(options);
        if (requestedFamily && requestedFamily !== 0 && requestedFamily !== family) {
            callFallbackLookup(hostnameRaw, options, callback);
            return;
        }
        if (hasAll(options)) {
            callback(null, [{ address: mapped, family }]);
            return;
        }
        callback(null, mapped, family);
    };
    return lookupImpl;
};
const shouldEnableFastDns = () => {
    const toggle = process.env.DISKD_SDK_FAST_DNS;
    if (toggle === '0' || toggle === 'false')
        return false;
    if (toggle === '1' || toggle === 'true')
        return true;
    const baseUrl = resolveDiskdBaseUrl();
    return baseUrl.includes('.local');
};
const safeReadHostname = (rawUrl) => {
    try {
        return new URL(rawUrl).hostname.toLowerCase();
    }
    catch {
        return null;
    }
};
const configureFastDns = () => {
    if (!shouldEnableFastDns())
        return;
    const baseUrlHostname = safeReadHostname(resolveDiskdBaseUrl());
    if (!baseUrlHostname)
        return;
    const map = readHostsMap();
    if (!map.has(baseUrlHostname))
        return;
    const lookup = createHostsLookup(map);
    setGlobalDispatcher(new Agent({ connect: { lookup } }));
};
configureFastDns();
