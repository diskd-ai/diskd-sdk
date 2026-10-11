/* REQ-3000-SDK-001: Calendar create carries the original of a display copy, reads return it, and update cannot set it. */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createCalendarClient } from '../calendar/calendar.js';
import type { AuthModule, CalendarEvent, UpdateEventParams } from '../index.js';

type FetchCall = { readonly url: string; readonly init?: RequestInit };

const ORIGIN_ID = '01JAGENDARDV0000000000000A';

/** Build deterministic auth for calendar client request assertions. */
const makeAuth = (): AuthModule => ({
  signIn: async () => {},
  signOut: () => {},
  handleRedirectCallback: async () => {},
  getAccessToken: async () => 'token-3000',
  getToken: () => ({ accessToken: 'token-3000' }),
  getWorkspaceId: async () => 'workspace-3000',
});

/** Answer one calendar request with the given event and record what was sent. */
const captureEventRequest = async (
  answer: Readonly<Record<string, unknown>>,
  fn: (calls: FetchCall[]) => Promise<void>
): Promise<void> => {
  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  (globalThis as { fetch: typeof fetch }).fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    calls.push({ url: input.toString(), init });
    return new Response(JSON.stringify(answer), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    await fn(calls);
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  }
};

const copyAnswer = {
  id: '01JCACPY000000000000000001',
  calendarId: '01JCACA0000000000000000001',
  title: 'RDV Dupont',
  originEventId: ORIGIN_ID,
};

test('createEvent sends originEventId unchanged and returns the stored origin', async () => {
  await captureEventRequest(copyAnswer, async (calls) => {
    const calendar = createCalendarClient({ auth: makeAuth(), url: 'http://app-service:3000' });
    const event: CalendarEvent = await calendar.createEvent({
      calendarId: '01JCACA0000000000000000001',
      title: 'RDV Dupont',
      startAt: '2026-10-14T08:00:00.000Z',
      endAt: '2026-10-14T09:00:00.000Z',
      originEventId: ORIGIN_ID,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'http://app-service:3000/api/calendar/events');
    assert.equal(JSON.parse(String(calls[0]?.init?.body)).originEventId, ORIGIN_ID);
    assert.equal(event.originEventId, ORIGIN_ID);
  });
});

test('an ordinary create sends no originEventId', async () => {
  await captureEventRequest({ ...copyAnswer, originEventId: null }, async (calls) => {
    const calendar = createCalendarClient({ auth: makeAuth(), url: 'http://app-service:3000' });
    const event = await calendar.createEvent({
      calendarId: '01JCACA0000000000000000001',
      title: 'RDV Dupont',
      startAt: '2026-10-14T08:00:00.000Z',
      endAt: '2026-10-14T09:00:00.000Z',
    });
    assert.equal('originEventId' in JSON.parse(String(calls[0]?.init?.body)), false);
    assert.equal(event.originEventId, null);
  });
});

test('update parameters cannot carry an origin', () => {
  type UpdateCarriesOrigin = 'originEventId' extends keyof UpdateEventParams ? true : false;
  const updateCarriesOrigin: UpdateCarriesOrigin = false;
  assert.equal(updateCarriesOrigin, false);
});
