import type { AuthModule } from '../auth/types.js';
import { resolveDiskdGatewayUrl } from '../env/baseUrl.js';
import { type HttpMethod, httpRequest, resolveAuthHeaders } from '../sdk/http.js';
import type {
  AddAttachmentParams,
  AddAttendeeParams,
  CalendarAccount,
  CalendarClient,
  CalendarEvent,
  CalendarSettings,
  CreateEventParams,
  EventAttachment,
  EventAttendee,
  EventNoteLink,
  LinkNoteParams,
  ListEventsParams,
  UpdateEventParams,
  UpdateSettingsParams,
} from './calendarTypes.js';

// ---------------------------------------------------------------------------
// Query params
// ---------------------------------------------------------------------------

const buildQuery = (entries: readonly (readonly [string, string | undefined])[]): string => {
  const parts: string[] = [];
  for (const [key, value] of entries) {
    if (value !== undefined) {
      parts.push(`${key}=${encodeURIComponent(value)}`);
    }
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
};

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

/**
 * Creates a Calendar REST client bound to a given auth module.
 *
 * The URL defaults to the centralized `DISKD_BASE_URL` gateway with the
 * `/platform/app` path prefix.
 *
 * Example:
 * ```ts
 * const cal = createCalendarClient({ auth });
 * const accounts = await cal.listAccounts();
 * const events = await cal.listEvents({ startAfter: '2026-01-01T00:00:00Z' });
 * await cal.attendees.add('event-01', { email: 'alice@example.com' });
 * ```
 */
export const createCalendarClient = (params: {
  readonly auth: AuthModule;
  readonly url?: string;
}): CalendarClient => {
  const baseUrl = (params.url ?? resolveDiskdGatewayUrl('platform/calendar')).replace(/\/+$/, '');

  const request = async <T>(
    method: HttpMethod,
    path: string,
    opts: { readonly body?: unknown } = {}
  ): Promise<T> => {
    const authHeaders = await resolveAuthHeaders(params.auth);
    return httpRequest<T>(
      {
        method,
        url: `${baseUrl}${path}`,
        authHeaders,
        body: opts.body,
      },
      'Calendar'
    );
  };

  const encId = (id: string): string => encodeURIComponent(id);

  return {
    listAccounts: async (): Promise<readonly CalendarAccount[]> => {
      return request<readonly CalendarAccount[]>('GET', '/api/calendar/accounts');
    },

    listEvents: async (listParams?: ListEventsParams): Promise<readonly CalendarEvent[]> => {
      const query = buildQuery([
        ['startAfter', listParams?.startAfter],
        ['startBefore', listParams?.startBefore],
        ['calendarIds', listParams?.calendarIds],
      ]);
      return request<readonly CalendarEvent[]>('GET', `/api/calendar/events${query}`);
    },

    getEvent: async (eventId: string): Promise<CalendarEvent> => {
      return request<CalendarEvent>('GET', `/api/calendar/events/${encId(eventId)}`);
    },

    createEvent: async (createParams: CreateEventParams): Promise<CalendarEvent> => {
      return request<CalendarEvent>('POST', '/api/calendar/events', { body: createParams });
    },

    updateEvent: async (eventId: string, updateParams: UpdateEventParams): Promise<CalendarEvent> => {
      return request<CalendarEvent>('PUT', `/api/calendar/events/${encId(eventId)}`, {
        body: updateParams,
      });
    },

    deleteEvent: async (eventId: string): Promise<void> => {
      await request<unknown>('DELETE', `/api/calendar/events/${encId(eventId)}`);
    },

    getSettings: async (): Promise<CalendarSettings> => {
      return request<CalendarSettings>('GET', '/api/calendar/settings');
    },

    updateSettings: async (settingsParams: UpdateSettingsParams): Promise<CalendarSettings> => {
      return request<CalendarSettings>('PUT', '/api/calendar/settings', { body: settingsParams });
    },

    attendees: {
      add: async (eventId: string, attendeeParams: AddAttendeeParams): Promise<EventAttendee> => {
        return request<EventAttendee>(
          'POST',
          `/api/calendar/events/${encId(eventId)}/attendees`,
          { body: attendeeParams }
        );
      },

      remove: async (eventId: string, attendeeId: string): Promise<void> => {
        await request<unknown>(
          'DELETE',
          `/api/calendar/events/${encId(eventId)}/attendees/${encId(attendeeId)}`
        );
      },

      updateRsvp: async (eventId: string, attendeeId: string, rsvp: string): Promise<EventAttendee> => {
        return request<EventAttendee>(
          'PUT',
          `/api/calendar/events/${encId(eventId)}/attendees/${encId(attendeeId)}/rsvp`,
          { body: { rsvp } }
        );
      },
    },

    noteLinks: {
      add: async (eventId: string, noteParams: LinkNoteParams): Promise<EventNoteLink> => {
        return request<EventNoteLink>(
          'POST',
          `/api/calendar/events/${encId(eventId)}/note-links`,
          { body: noteParams }
        );
      },

      remove: async (eventId: string, linkId: string): Promise<void> => {
        await request<unknown>(
          'DELETE',
          `/api/calendar/events/${encId(eventId)}/note-links/${encId(linkId)}`
        );
      },
    },

    attachments: {
      add: async (eventId: string, attachmentParams: AddAttachmentParams): Promise<EventAttachment> => {
        return request<EventAttachment>(
          'POST',
          `/api/calendar/events/${encId(eventId)}/attachments`,
          { body: attachmentParams }
        );
      },

      remove: async (eventId: string, attachmentId: string): Promise<void> => {
        await request<unknown>(
          'DELETE',
          `/api/calendar/events/${encId(eventId)}/attachments/${encId(attachmentId)}`
        );
      },
    },
  };
};
