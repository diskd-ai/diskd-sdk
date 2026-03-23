import type { AuthModule } from '../auth/types.js';
import { resolveDiskdGatewayUrl } from '../env/baseUrl.js';
import { buildQuery, type HttpMethod, httpRequest, resolveAuthHeaders } from '../sdk/http.js';
import type {
  RoutineRun,
  RoutineRunGetParams,
  RoutineRunListParams,
  RoutineRunsClient,
} from './routineRunsTypes.js';

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

/**
 * Creates a Routine Runs REST client bound to a given auth module.
 *
 * The URL defaults to the centralized `APIS_BASE_URL` gateway with the
 * `/platform/routineRuns` path prefix.
 *
 * Example:
 * ```ts
 * const runs = createRoutineRunsClient({ auth });
 * const list = await runs.list({ routineSlug: 'intake-sorter' });
 * ```
 */
export const createRoutineRunsClient = (params: {
  readonly auth: AuthModule;
  readonly url?: string;
}): RoutineRunsClient => {
  const baseUrl = (params.url ?? resolveDiskdGatewayUrl('platform/routineRuns')).replace(
    /\/+$/,
    ''
  );

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
      'RoutineRuns'
    );
  };

  return {
    list: async (listParams: RoutineRunListParams): Promise<readonly RoutineRun[]> => {
      const slug = encodeURIComponent(listParams.routineSlug);
      const query = buildQuery([
        ['scope', listParams.scope],
        ['projectName', listParams.projectName],
      ]);
      const result = await request<{ readonly items: readonly RoutineRun[] }>(
        'GET',
        `/api/routines/${slug}/executions${query}`
      );
      return result.items;
    },

    get: async (getParams: RoutineRunGetParams): Promise<RoutineRun> => {
      const slug = encodeURIComponent(getParams.routineSlug);
      const executionId = encodeURIComponent(getParams.executionId);
      const result = await request<{ readonly run: RoutineRun }>(
        'GET',
        `/api/routines/${slug}/executions/${executionId}`
      );
      return result.run;
    },
  };
};
