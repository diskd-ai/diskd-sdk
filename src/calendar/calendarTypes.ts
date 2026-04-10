// Calendar domain types.
// Wire format is camelCase (same as backend DTOs -- no mapping needed).

// -- Domain models --

export type CalendarEventNoteRef = {
  readonly noteDiskPath: string;
  readonly title: string;
  readonly linkType: 'context' | 'outcome';
};

export type CalendarEventMetadata = {
  readonly linkedNotes?: readonly CalendarEventNoteRef[];
  readonly timeBlockCategory?: 'meeting' | 'focus' | 'personal' | 'admin';
};

export type CalendarAccount = {
  readonly id: string;
  readonly provider: string;
  readonly email: string;
  readonly status: string;
  readonly lastSyncAt: string | null;
  readonly calendars: readonly Calendar[];
};

export type Calendar = {
  readonly id: string;
  readonly accountId: string;
  readonly name: string;
  readonly color: string;
  readonly isVisible: boolean;
  readonly sortOrder: number;
};

export type CalendarEvent = {
  readonly id: string;
  readonly calendarId: string;
  readonly title: string;
  readonly description: string | null;
  readonly startAt: string;
  readonly endAt: string;
  readonly allDay: boolean;
  readonly timezoneId: string;
  readonly location: string | null;
  readonly conferencing: unknown | null;
  readonly organizer: unknown | null;
  readonly recurrence: unknown | null;
  readonly reminders: unknown | null;
  readonly status: string;
  readonly color: string;
  readonly sourceType: string;
  readonly visibility: string;
  readonly transparency: string;
  readonly attendees: readonly EventAttendee[];
  readonly attachments: readonly EventAttachment[];
  readonly noteLinks: readonly EventNoteLink[];
  readonly metadata: CalendarEventMetadata | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type EventAttendee = {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly role: string;
  readonly rsvp: string;
};

export type EventAttachment = {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly diskPath: string | null;
  readonly url: string | null;
  readonly indexingStatus: string | null;
};

export type EventNoteLink = {
  readonly id: string;
  readonly noteDiskPath: string;
  readonly title: string;
  readonly linkType: string;
  readonly pinned: boolean;
  readonly publishedAt: string | null;
};

export type CalendarSettings = {
  readonly weekStartDay: number;
  readonly defaultView: string;
  readonly timezone: string | null;
  readonly defaultCalendarId: string | null;
};

// -- Input params --

export type ListEventsParams = {
  readonly startAfter?: string;
  readonly startBefore?: string;
  readonly calendarIds?: string;
};

export type CreateEventParams = {
  readonly calendarId: string;
  readonly title: string;
  readonly description?: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly allDay?: boolean;
  readonly timezoneId?: string;
  readonly location?: string;
  readonly conferencing?: { readonly type: string; readonly url: string };
  readonly organizer?: { readonly email: string; readonly name?: string };
  readonly recurrence?: { readonly rule: string };
  readonly reminders?: {
    readonly useDefault: boolean;
    readonly overrides?: readonly { readonly method: string; readonly minutes: number }[];
  };
  readonly color?: string;
  readonly visibility?: 'default' | 'public' | 'private';
  readonly transparency?: 'opaque' | 'transparent';
};

export type UpdateEventParams = Partial<Omit<CreateEventParams, 'calendarId'>> & {
  readonly status?: 'active' | 'cancelled';
  readonly metadata?: CalendarEventMetadata | null;
};

export type AddAttendeeParams = {
  readonly email: string;
  readonly name?: string;
  readonly role?: 'required' | 'optional' | 'organizer';
};

export type LinkNoteParams = {
  readonly noteDiskPath: string;
  readonly title: string;
  readonly linkType: 'context' | 'outcome';
  readonly pinned?: boolean;
};

export type AddAttachmentParams = {
  readonly type: 'disk_item' | 'url';
  readonly title: string;
  readonly diskPath?: string;
  readonly url?: string;
};

export type UpdateSettingsParams = {
  readonly defaultCalendarId?: string | null;
  readonly weekStartDay?: number;
  readonly defaultView?: 'day' | 'week' | 'month';
  readonly timezone?: string | null;
};

// -- Client interface --

/**
 * Calendar REST client with attendees, noteLinks, and attachments sub-namespaces.
 *
 * Obtain via `diskd.platform.calendar({ auth })`.
 * Maps to app-service `/api/calendar` endpoints.
 */
export type CalendarClient = {
  /** GET /api/calendar/accounts */
  readonly listAccounts: () => Promise<readonly CalendarAccount[]>;
  /** GET /api/calendar/events */
  readonly listEvents: (params?: ListEventsParams) => Promise<readonly CalendarEvent[]>;
  /** GET /api/calendar/events/:eventId */
  readonly getEvent: (eventId: string) => Promise<CalendarEvent>;
  /** POST /api/calendar/events */
  readonly createEvent: (params: CreateEventParams) => Promise<CalendarEvent>;
  /** PUT /api/calendar/events/:eventId */
  readonly updateEvent: (eventId: string, params: UpdateEventParams) => Promise<CalendarEvent>;
  /** DELETE /api/calendar/events/:eventId */
  readonly deleteEvent: (eventId: string) => Promise<void>;
  /** GET /api/calendar/settings */
  readonly getSettings: () => Promise<CalendarSettings>;
  /** PUT /api/calendar/settings */
  readonly updateSettings: (params: UpdateSettingsParams) => Promise<CalendarSettings>;

  /** Event attendees sub-resource. */
  readonly attendees: {
    /** POST /api/calendar/events/:eventId/attendees */
    readonly add: (eventId: string, params: AddAttendeeParams) => Promise<EventAttendee>;
    /** DELETE /api/calendar/events/:eventId/attendees/:attendeeId */
    readonly remove: (eventId: string, attendeeId: string) => Promise<void>;
    /** PUT /api/calendar/events/:eventId/attendees/:attendeeId/rsvp */
    readonly updateRsvp: (eventId: string, attendeeId: string, rsvp: string) => Promise<EventAttendee>;
  };

  /** Event note links sub-resource. */
  readonly noteLinks: {
    /** POST /api/calendar/events/:eventId/note-links */
    readonly add: (eventId: string, params: LinkNoteParams) => Promise<EventNoteLink>;
    /** DELETE /api/calendar/events/:eventId/note-links/:linkId */
    readonly remove: (eventId: string, linkId: string) => Promise<void>;
  };

  /** Event attachments sub-resource. */
  readonly attachments: {
    /** POST /api/calendar/events/:eventId/attachments */
    readonly add: (eventId: string, params: AddAttachmentParams) => Promise<EventAttachment>;
    /** DELETE /api/calendar/events/:eventId/attachments/:attachmentId */
    readonly remove: (eventId: string, attachmentId: string) => Promise<void>;
  };
};
