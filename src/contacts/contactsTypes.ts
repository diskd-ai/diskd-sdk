// Contacts domain types.
// Wire format is camelCase (same as app-service backend DTOs).

export type ContactSource = 'manual' | 'google' | 'import';

export type ContactMethod = {
  readonly id: string;
  readonly type: 'email' | 'phone';
  readonly value: string;
  readonly isPrimary: boolean;
};

export type ContactProjectLink = {
  readonly projectId: string;
  readonly role: 'stakeholder' | 'client' | 'vendor' | 'teammate' | 'other';
};

export type Contact = {
  readonly id: string;
  readonly displayName: string;
  readonly givenName: string | null;
  readonly familyName: string | null;
  readonly title: string | null;
  readonly tags: readonly string[];
  readonly source: ContactSource;
  readonly isArchived: boolean;
  readonly methods: readonly ContactMethod[];
  readonly projectLinks: readonly ContactProjectLink[];
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type ListContactsParams = {
  readonly source?: ContactSource;
  readonly isArchived?: boolean;
  readonly projectId?: string;
};

export type SearchContactsParams = {
  readonly query: string;
};

export type CreateContactParams = {
  readonly displayName: string;
  readonly givenName?: string | null;
  readonly familyName?: string | null;
  readonly title?: string | null;
  readonly tags?: readonly string[];
  readonly source?: ContactSource;
  readonly methods?: readonly AddContactMethodParams[];
};

export type UpdateContactParams = {
  readonly displayName?: string;
  readonly givenName?: string | null;
  readonly familyName?: string | null;
  readonly title?: string | null;
  readonly tags?: readonly string[];
};

export type AddContactMethodParams = {
  readonly type: 'email' | 'phone';
  readonly value: string;
  readonly isPrimary?: boolean;
};

export type LinkContactToProjectParams = {
  readonly projectId: string;
  readonly role?: 'stakeholder' | 'client' | 'vendor' | 'teammate' | 'other';
};

/**
 * Contacts REST client.
 *
 * Obtain via `diskd.platform.contacts({ auth })`.
 * Maps to app-service `/api/contacts` endpoints.
 */
export type ContactsClient = {
  readonly list: (params?: ListContactsParams) => Promise<readonly Contact[]>;
  readonly search: (params: SearchContactsParams) => Promise<readonly Contact[]>;
  readonly get: (contactId: string) => Promise<Contact>;
  readonly create: (params: CreateContactParams) => Promise<Contact>;
  readonly update: (contactId: string, params: UpdateContactParams) => Promise<Contact>;
  readonly archive: (contactId: string) => Promise<Contact>;
  readonly delete: (contactId: string) => Promise<void>;
  readonly methods: {
    readonly add: (contactId: string, params: AddContactMethodParams) => Promise<Contact>;
    readonly remove: (contactId: string, methodId: string) => Promise<void>;
  };
  readonly projectLinks: {
    readonly add: (contactId: string, params: LinkContactToProjectParams) => Promise<Contact>;
    readonly remove: (contactId: string, projectId: string) => Promise<void>;
  };
};
