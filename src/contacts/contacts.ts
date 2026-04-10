import type { AuthModule } from '../auth/types.js';
import { resolveDiskdGatewayUrl } from '../env/baseUrl.js';
import {
  type HttpMethod,
  httpRequest,
  resolveAuthHeaders,
} from '../sdk/http.js';
import type {
  AddContactMethodParams,
  Contact,
  ContactsClient,
  CreateContactParams,
  LinkContactToProjectParams,
  ListContactsParams,
  SearchContactsParams,
  UpdateContactParams,
} from './contactsTypes.js';

/**
 * buildQuery renders optional Contacts query params using the standard platform client pattern.
 */
const buildQuery = (
  entries: readonly (readonly [string, string | undefined])[]
): string => {
  const parts: string[] = [];
  for (const [key, value] of entries) {
    if (value !== undefined) {
      parts.push(`${key}=${encodeURIComponent(value)}`);
    }
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
};

/**
 * createContactsClient builds the Contacts REST client bound to an auth module.
 */
export const createContactsClient = (params: {
  readonly auth: AuthModule;
  readonly url?: string;
}): ContactsClient => {
  const baseUrl = (params.url ?? resolveDiskdGatewayUrl('platform/contacts')).replace(/\/+$/, '');

  /**
   * request centralizes auth headers and HTTP invocation for the Contacts client.
   */
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
      'Contacts'
    );
  };

  /**
   * encId safely escapes a path identifier used in REST routes.
   */
  const encId = (id: string): string => encodeURIComponent(id);

  return {
    list: async (listParams?: ListContactsParams): Promise<readonly Contact[]> => {
      const query = buildQuery([
        ['source', listParams?.source],
        ['isArchived', listParams?.isArchived !== undefined ? String(listParams.isArchived) : undefined],
        ['projectId', listParams?.projectId],
      ]);
      return request<readonly Contact[]>('GET', `/api/contacts${query}`);
    },

    search: async (searchParams: SearchContactsParams): Promise<readonly Contact[]> => {
      const query = buildQuery([['query', searchParams.query]]);
      return request<readonly Contact[]>('GET', `/api/contacts/search${query}`);
    },

    get: async (contactId: string): Promise<Contact> => {
      return request<Contact>('GET', `/api/contacts/${encId(contactId)}`);
    },

    create: async (createParams: CreateContactParams): Promise<Contact> => {
      return request<Contact>('POST', '/api/contacts', {
        body: createParams,
      });
    },

    update: async (
      contactId: string,
      updateParams: UpdateContactParams
    ): Promise<Contact> => {
      return request<Contact>('PATCH', `/api/contacts/${encId(contactId)}`, {
        body: updateParams,
      });
    },

    archive: async (contactId: string): Promise<Contact> => {
      return request<Contact>('POST', `/api/contacts/${encId(contactId)}/archive`);
    },

    delete: async (contactId: string): Promise<void> => {
      await request<unknown>('DELETE', `/api/contacts/${encId(contactId)}`);
    },

    methods: {
      add: async (
        contactId: string,
        methodParams: AddContactMethodParams
      ): Promise<Contact> => {
        return request<Contact>(
          'POST',
          `/api/contacts/${encId(contactId)}/methods`,
          { body: methodParams }
        );
      },

      remove: async (contactId: string, methodId: string): Promise<void> => {
        await request<unknown>(
          'DELETE',
          `/api/contacts/${encId(contactId)}/methods/${encId(methodId)}`
        );
      },
    },

    projectLinks: {
      add: async (
        contactId: string,
        linkParams: LinkContactToProjectParams
      ): Promise<Contact> => {
        return request<Contact>(
          'POST',
          `/api/contacts/${encId(contactId)}/project-links`,
          { body: linkParams }
        );
      },

      remove: async (contactId: string, projectId: string): Promise<void> => {
        await request<unknown>(
          'DELETE',
          `/api/contacts/${encId(contactId)}/project-links/${encId(projectId)}`
        );
      },
    },
  };
};
