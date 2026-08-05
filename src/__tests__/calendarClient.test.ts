/* REQ-3057-4: Calendar SDK exposes and sends the canonical RSVP contract. */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createCalendarClient } from '../calendar/calendar.js';
import type { AuthModule, CalendarRsvp } from '../index.js';

type FetchCall = { readonly url: string; readonly init?: RequestInit };

/** Build deterministic auth for calendar client request assertions. */
const makeAuth = (): AuthModule => ({
  signIn: async () => {},
  signOut: () => {},
  handleRedirectCallback: async () => {},
  getAccessToken: async () => 'token-3057',
  getToken: () => ({ accessToken: 'token-3057' }),
  getWorkspaceId: async () => 'workspace-3057',
});

/** Capture one calendar request while returning a canonical attendee response. */
const captureCalendarRequest = async (fn: (calls: FetchCall[]) => Promise<void>): Promise<void> => {
  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  (globalThis as { fetch: typeof fetch }).fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    calls.push({ url: input.toString(), init });
    return new Response(
      JSON.stringify({
        id: 'attendee-3057',
        email: 'connected@example.com',
        name: null,
        role: 'required',
        rsvp: 'accepted',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };
  try {
    await fn(calls);
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  }
};

test('calendar attendee RSVP sends every canonical value unchanged', async () => {
  const canonicalValues: readonly CalendarRsvp[] = [
    'accepted',
    'tentative',
    'declined',
    'needsAction',
  ];

  await captureCalendarRequest(async (calls) => {
    const calendar = createCalendarClient({
      auth: makeAuth(),
      url: 'http://app-service:3000',
    });

    for (const rsvp of canonicalValues) {
      await calendar.attendees.updateRsvp('event/3057', 'attendee/3057', rsvp);
    }

    assert.equal(calls.length, canonicalValues.length);
    calls.forEach((call, index) => {
      assert.equal(
        call.url,
        'http://app-service:3000/api/calendar/events/event%2F3057/attendees/attendee%2F3057/rsvp'
      );
      assert.equal(call.init?.method, 'PUT');
      assert.deepEqual(JSON.parse(String(call.init?.body)), {
        rsvp: canonicalValues[index],
      });
    });
  });
});
