import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuth } from '../auth/createAuth.js';
const makeStorage = () => {
    const map = new Map();
    return {
        storage: {
            getItem: (key) => map.get(key) ?? null,
            setItem: (key, value) => void map.set(key, value),
            removeItem: (key) => void map.delete(key),
        },
        map,
    };
};
test('createAuth (pkce) builds authorization URL and stores verifier/state', async () => {
    const { storage, map } = makeStorage();
    const location = { href: 'https://app.example/' };
    globalThis.sessionStorage = storage;
    globalThis.location = location;
    const originalFetch = globalThis.fetch;
    const fetchMock = async (input) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.endsWith('/.well-known/openid-configuration')) {
            return new Response(JSON.stringify({
                issuer: 'https://issuer.example',
                authorization_endpoint: 'https://issuer.example/oauth2/auth',
                token_endpoint: 'https://issuer.example/oauth2/token',
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ error: 'unexpected' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    };
    globalThis.fetch = fetchMock;
    try {
        const auth = await createAuth({
            issuer: 'https://issuer.example',
            clientId: 'client-id',
            redirectUri: 'https://app.example/callback',
            scopes: ['openid'],
            audience: 'diskd-api',
        });
        await auth.signIn();
        assert.ok(location.href.startsWith('https://issuer.example/oauth2/auth?'));
        assert.ok(map.get('diskd_pkce_verifier'));
        assert.ok(map.get('diskd_pkce_state'));
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
