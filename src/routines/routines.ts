import type { AuthModule } from '../auth/types.js';
import { resolveDiskdGatewayUrl } from '../env/baseUrl.js';
import { buildQuery, httpRequest, resolveAuthHeaders, type HttpMethod } from '../sdk/http.js';
import type {
  Routine,
  RoutineCreateParams,
  RoutineDeleteParams,
  RoutineGetParams,
  RoutineListParams,
  RoutineScopeRef,
  RoutineUpdateParams,
  RoutinesClient,
} from './routinesTypes.js';

// ---------------------------------------------------------------------------
// Scope query params
// ---------------------------------------------------------------------------

const buildScopeQuery = (scope?: string, projectName?: string): string =>
  buildQuery([
    ['scope', scope],
    ['projectName', projectName],
  ]);

const scopeRefToQuery = (scope?: RoutineScopeRef): string => {
  if (!scope) return '';
  if (scope.scopeType === 'project') {
    return buildScopeQuery(scope.scopeType, scope.projectName);
  }
  return buildScopeQuery(scope.scopeType);
};

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

/**
 * Creates a Routines REST client bound to a given auth module.
 *
 * The URL defaults to the centralized `DISKD_BASE_URL` gateway with the
 * `/platform/app` path prefix.
 *
 * Example:
 * ```ts
 * const routines = createRoutinesClient({ auth });
 * const all = await routines.list({ scope: 'profile' });
 * ```
 */
export const createRoutinesClient = (params: {
  readonly auth: AuthModule;
  readonly url?: string;
}): RoutinesClient => {
  const baseUrl = (params.url ?? resolveDiskdGatewayUrl('platform/app')).replace(/\/+$/, '');

  const request = async <T>(
    method: HttpMethod,
    path: string,
    opts: { readonly body?: unknown } = {},
  ): Promise<T> => {
    const authHeaders = await resolveAuthHeaders(params.auth);
    return httpRequest<T>({
      method,
      url: `${baseUrl}${path}`,
      authHeaders,
      body: opts.body,
    }, 'Routines');
  };

  return {
    list: async (listParams?: RoutineListParams): Promise<readonly Routine[]> => {
      const query = buildScopeQuery(listParams?.scope, listParams?.projectName);
      const result = await request<{ readonly items: readonly Routine[] }>('GET', `/api/routines${query}`);
      return result.items;
    },

    get: async (getParams: RoutineGetParams): Promise<Routine> => {
      const query = buildScopeQuery(getParams.scope, getParams.projectName);
      const slug = encodeURIComponent(getParams.slug);
      const result = await request<{ readonly routine: Routine }>('GET', `/api/routines/${slug}${query}`);
      return result.routine;
    },

    create: async (createParams: RoutineCreateParams): Promise<Routine> => {
      const result = await request<{ readonly routine: Routine }>('POST', '/api/routines', {
        body: createParams,
      });
      return result.routine;
    },

    update: async (slug: string, updateParams: RoutineUpdateParams, scope?: RoutineScopeRef): Promise<Routine> => {
      const query = scopeRefToQuery(scope);
      const encodedSlug = encodeURIComponent(slug);
      const result = await request<{ readonly routine: Routine }>('PATCH', `/api/routines/${encodedSlug}${query}`, {
        body: updateParams,
      });
      return result.routine;
    },

    delete: async (deleteParams: RoutineDeleteParams): Promise<void> => {
      const query = buildScopeQuery(deleteParams.scope, deleteParams.projectName);
      const slug = encodeURIComponent(deleteParams.slug);
      await request<unknown>('DELETE', `/api/routines/${slug}${query}`);
    },
  };
};
