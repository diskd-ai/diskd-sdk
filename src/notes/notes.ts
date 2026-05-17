import type { AuthModule } from '../auth/types.js';
import { resolveDiskdGatewayUrl } from '../env/baseUrl.js';
import { buildQuery, type HttpMethod, httpRequest, resolveAuthHeaders } from '../sdk/http.js';
import type {
  CreateProjectNoteParams,
  ProjectNote,
  ProjectNoteHeader,
  ProjectNotesClient,
} from './notesTypes.js';

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

/** URL-encode a path segment used by the Project Notes REST client. */
const encId = (id: string): string => encodeURIComponent(id);

/**
 * Creates a project-scoped Notes REST client bound to a given auth module.
 *
 * The URL defaults to the centralized `APIS_BASE_URL` gateway with the
 * `/v1/platform/projects` path prefix. The project id is captured in the
 * client factory so callers cannot accidentally provide workspace/project
 * scope per request.
 */
export const createProjectNotesClient = (params: {
  readonly auth: AuthModule;
  readonly projectId: string;
  readonly url?: string;
}): ProjectNotesClient => {
  const baseUrl = (params.url ?? resolveDiskdGatewayUrl('platform/projects')).replace(/\/+$/, '');

  /** Send an authenticated Project Notes REST request through the SDK transport. */
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
      'Project Notes'
    );
  };

  return {
    create: async (createParams: CreateProjectNoteParams): Promise<ProjectNote> => {
      return request<ProjectNote>('POST', '/api/project-notes', {
        body: {
          ...createParams,
          projectId: params.projectId,
        },
      });
    },

    read: async (noteId: string): Promise<ProjectNote> => {
      return request<ProjectNote>(
        'GET',
        `/api/project-notes/${encId(noteId)}${buildQuery([['projectId', params.projectId]])}`
      );
    },

    list: async (): Promise<readonly ProjectNoteHeader[]> => {
      return request<readonly ProjectNoteHeader[]>(
        'GET',
        `/api/project-notes${buildQuery([['projectId', params.projectId]])}`
      );
    },
  };
};
