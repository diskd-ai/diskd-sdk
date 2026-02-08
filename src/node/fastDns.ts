import fs from 'node:fs';
import dns from 'node:dns';
import type { LookupAddress, LookupAllOptions, LookupOneOptions } from 'node:dns';
import type { TcpSocketConnectOpts } from 'node:net';

import { Agent, setGlobalDispatcher } from 'undici';
import { resolveDiskdBaseUrl } from '../env/baseUrl.js';

type HostsMap = ReadonlyMap<string, string>;
type NetLookupFunction = NonNullable<TcpSocketConnectOpts['lookup']>;

const parseHostsFile = (raw: string): Map<string, string> => {
  const map = new Map<string, string>();
  for (const lineRaw of raw.split(/\r?\n/u)) {
    const line = lineRaw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;

    const parts = line.split(/\s+/u).filter((part) => part.length > 0);
    const ip = parts[0];
    if (!ip) continue;

    for (const host of parts.slice(1)) {
      const normalized = host.trim().toLowerCase();
      if (normalized.length === 0) continue;
      if (!map.has(normalized)) {
        map.set(normalized, ip);
      }
    }
  }
  return map;
};

const readHostsMap = (): Map<string, string> => {
  const content = fs.readFileSync('/etc/hosts', 'utf8');
  return parseHostsFile(content);
};

type LookupOneCallback = (err: NodeJS.ErrnoException | null, address: string, family: number) => void;
type LookupAllCallback = (err: NodeJS.ErrnoException | null, addresses: readonly LookupAddress[]) => void;

const hasAll = (options: unknown): options is LookupAllOptions =>
  typeof options === 'object' &&
  options !== null &&
  (options as { readonly all?: unknown }).all === true;

const readFamily = (options: unknown): number | undefined => {
  if (typeof options === 'number') return options;
  if (typeof options !== 'object' || options === null) return undefined;
  const family = (options as { readonly family?: unknown }).family;
  return typeof family === 'number' ? family : undefined;
};

const callFallbackLookup = (
  hostname: string,
  options: unknown,
  callback: unknown,
): void => {
  if (typeof options === 'function') {
    dns.lookup(hostname, options as LookupOneCallback);
    return;
  }

  if (typeof callback !== 'function') return;

  if (options === undefined) {
    dns.lookup(hostname, callback as LookupOneCallback);
    return;
  }

  if (typeof options === 'number') {
    dns.lookup(hostname, options, callback as LookupOneCallback);
    return;
  }

  if (hasAll(options)) {
    dns.lookup(hostname, options, callback as LookupAllCallback);
    return;
  }

  dns.lookup(hostname, options as LookupOneOptions, callback as LookupOneCallback);
};

const createHostsLookup = (map: HostsMap): NetLookupFunction => {
  const lookupImpl = (...args: readonly unknown[]): void => {
    const hostnameRaw = args[0];
    if (typeof hostnameRaw !== 'string') return;
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
      (callback as LookupAllCallback)(null, [{ address: mapped, family }]);
      return;
    }

    (callback as LookupOneCallback)(null, mapped, family);
  };

  return lookupImpl as unknown as NetLookupFunction;
};

const shouldEnableFastDns = (): boolean => {
  const toggle = process.env.DISKD_SDK_FAST_DNS;
  if (toggle === '0' || toggle === 'false') return false;
  if (toggle === '1' || toggle === 'true') return true;

  const baseUrl = resolveDiskdBaseUrl();
  return baseUrl.includes('.local');
};

const safeReadHostname = (rawUrl: string): string | null => {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
};

const configureFastDns = (): void => {
  if (!shouldEnableFastDns()) return;

  const baseUrlHostname = safeReadHostname(resolveDiskdBaseUrl());
  if (!baseUrlHostname) return;

  const map = readHostsMap();
  if (!map.has(baseUrlHostname)) return;

  const lookup = createHostsLookup(map);
  setGlobalDispatcher(new Agent({ connect: { lookup } }));
};

configureFastDns();
