import type { AuthModule } from '../auth/types.js';
import { resolveDiskdGatewayUrl } from '../env/baseUrl.js';
import { type HttpMethod, httpRequest, resolveAuthHeaders } from '../sdk/http.js';
import type {
  Project,
  ProjectCreateParams,
  ProjectDetailed,
  ProjectsClient,
  ProjectUpdateParams,
} from './projectsTypes.js';

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

/**
 * Creates a Projects REST client bound to a given auth module.
 *
 * The URL defaults to the centralized `DISKD_BASE_URL` gateway with the
 * `/platform/projects` path prefix.
 *
 * Example:
 * ```ts
 * const projects = createProjectsClient({ auth });
 * const all = await projects.list();
 * const system = await projects.getSystem();
 * ```
 */
export const createProjectsClient = (params: {
  readonly auth: AuthModule;
  readonly url?: string;
}): ProjectsClient => {
  const baseUrl = (params.url ?? resolveDiskdGatewayUrl('platform/projects')).replace(/\/+$/, '');

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
      'Projects'
    );
  };

  const encId = (id: string): string => encodeURIComponent(id);

  return {
    list: async (): Promise<readonly Project[]> => {
      return request<readonly Project[]>('GET', '/api/projects');
    },

    get: async (projectId: string): Promise<ProjectDetailed> => {
      return request<ProjectDetailed>('GET', `/api/projects/${encId(projectId)}`);
    },

    getSystem: async (): Promise<ProjectDetailed> => {
      return request<ProjectDetailed>('GET', '/api/projects/system');
    },

    create: async (createParams: ProjectCreateParams): Promise<Project> => {
      return request<Project>('POST', '/api/projects', {
        body: createParams,
      });
    },

    update: async (projectId: string, updateParams: ProjectUpdateParams): Promise<Project> => {
      return request<Project>('PUT', `/api/projects/${encId(projectId)}`, {
        body: updateParams,
      });
    },

    delete: async (projectId: string): Promise<void> => {
      await request<unknown>('DELETE', `/api/projects/${encId(projectId)}`);
    },
  };
};
