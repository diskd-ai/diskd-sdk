import type { AuthModule } from '../auth/types.js';
import { resolveDiskdGatewayUrl } from '../env/baseUrl.js';
import { type HttpMethod, httpRequest, resolveAuthHeaders } from '../sdk/http.js';
import type {
  Operative,
  OperativeAddFilesParams,
  OperativeAddSkillsParams,
  OperativeAddToolsParams,
  OperativeCreateParams,
  OperativeFile,
  OperativeGetBySlugParams,
  OperativeListParams,
  OperativeSkill,
  OperativesClient,
  OperativeTool,
  OperativeUpdateParams,
} from './operativesTypes.js';

// ---------------------------------------------------------------------------
// Wire types (app-service uses intelAccess / sourceId / equipmentType)
// ---------------------------------------------------------------------------

type WireOperative = {
  readonly id: string;
  readonly scope: 'project' | 'workspace';
  readonly projectId: string | null;
  readonly workspaceId: string;
  readonly name: string;
  readonly slug: string;
  readonly avatarUrl?: string;
  readonly intelAccess: 'all' | 'selected';
  readonly engineProvider?: string;
  readonly engineModel?: string;
  readonly engine: 'quick' | 'deep';
  readonly orders: string;
  readonly ordersUpdatedAt?: string;
  readonly trustLevel: 0 | 1 | 2 | 3;
  readonly isPrimary: boolean;
  readonly status: 'active' | 'standby';
  readonly sealGradient?: readonly [string, string];
  readonly createdBy?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

type WireIntel = {
  readonly id: string;
  readonly operativeId: string;
  readonly sourceId: string;
  readonly createdAt: string;
};

type WireEquipment = {
  readonly id: string;
  readonly operativeId: string;
  readonly equipmentType: 'skill' | 'mcp_tool';
  readonly refId?: string;
  readonly selector?: string;
  readonly display?: { readonly serverName: string; readonly toolName: string };
  readonly resolutionStatus?: 'valid' | 'disabled_globally' | 'unknown';
  readonly createdAt: string;
};

type WireEquipmentList = {
  readonly registryStatus: 'ok' | 'unavailable';
  readonly items: readonly WireEquipment[];
};

// ---------------------------------------------------------------------------
// Decode / encode
// ---------------------------------------------------------------------------

const decodeOperative = (wire: WireOperative): Operative => {
  const base = {
    id: wire.id,
    workspaceId: wire.workspaceId,
    name: wire.name,
    slug: wire.slug,
    avatarUrl: wire.avatarUrl,
    fileAccess: wire.intelAccess,
    engineProvider: wire.engineProvider,
    engineModel: wire.engineModel,
    engine: wire.engine,
    orders: wire.orders,
    ordersUpdatedAt: wire.ordersUpdatedAt,
    trustLevel: wire.trustLevel,
    isPrimary: wire.isPrimary,
    status: wire.status,
    sealGradient: wire.sealGradient,
    createdBy: wire.createdBy,
    createdAt: wire.createdAt,
    updatedAt: wire.updatedAt,
  };

  if (wire.scope === 'workspace' || wire.projectId === null) {
    return { ...base, scope: 'workspace' };
  }

  return { ...base, scope: 'project', projectId: wire.projectId };
};

const decodeFile = (wire: WireIntel): OperativeFile => ({
  id: wire.id,
  operativeId: wire.operativeId,
  path: wire.sourceId,
  createdAt: wire.createdAt,
});

const decodeSkill = (wire: WireEquipment): OperativeSkill => ({
  id: wire.id,
  operativeId: wire.operativeId,
  refId: wire.refId ?? '',
  createdAt: wire.createdAt,
});

const decodeTool = (wire: WireEquipment): OperativeTool => ({
  id: wire.id,
  operativeId: wire.operativeId,
  selector: wire.selector ?? '',
  display: wire.display,
  resolutionStatus: wire.resolutionStatus,
  createdAt: wire.createdAt,
});

/** Encode SDK field names to app-service wire format. */
const encodeParams = (params: Record<string, unknown>): Record<string, unknown> => {
  const wire: Record<string, unknown> = { ...params };
  if ('fileAccess' in wire) {
    wire.intelAccess = wire.fileAccess;
    delete wire.fileAccess;
  }
  return wire;
};

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
 * Creates an Operatives REST client bound to a given auth module.
 *
 * The URL defaults to the centralized `APIS_BASE_URL` gateway with the
 * `/platform/app` path prefix.
 *
 * Example:
 * ```ts
 * const ops = createOperativesClient({ auth });
 * const list = await ops.list({ projectId: 'proj-1' });
 * await ops.files.add('op-01', { paths: ['/docs/notes'] });
 * await ops.skills.add('op-01', { refIds: ['web-search'] });
 * await ops.tools.add('op-01', { selectors: ['github/search_repos'] });
 * ```
 */
export const createOperativesClient = (params: {
  readonly auth: AuthModule;
  readonly url?: string;
}): OperativesClient => {
  const baseUrl = (params.url ?? resolveDiskdGatewayUrl('platform/operatives')).replace(/\/+$/, '');

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
      'Operatives'
    );
  };

  const encId = (id: string): string => encodeURIComponent(id);

  return {
    list: async (listParams: OperativeListParams): Promise<readonly Operative[]> => {
      const query = buildQuery([['projectId', listParams.projectId]]);
      const items = await request<readonly WireOperative[]>('GET', `/api/operatives${query}`);
      return items.map(decodeOperative);
    },

    listWorkspace: async (): Promise<readonly Operative[]> => {
      const response = await request<{ readonly items: readonly WireOperative[] }>(
        'GET',
        '/api/workspace-operatives'
      );
      return response.items.map(decodeOperative);
    },

    get: async (operativeId: string): Promise<Operative> => {
      const wire = await request<WireOperative>('GET', `/api/operatives/${encId(operativeId)}`);
      return decodeOperative(wire);
    },

    getBySlug: async (slugParams: OperativeGetBySlugParams): Promise<Operative> => {
      const query = buildQuery([
        ['projectId', slugParams.projectId],
        ['slug', slugParams.slug],
      ]);
      const wire = await request<WireOperative>('GET', `/api/operatives/by-slug${query}`);
      return decodeOperative(wire);
    },

    create: async (createParams: OperativeCreateParams): Promise<Operative> => {
      const wire = await request<WireOperative>('POST', '/api/operatives', {
        body: encodeParams({ ...createParams }),
      });
      return decodeOperative(wire);
    },

    update: async (
      operativeId: string,
      updateParams: OperativeUpdateParams
    ): Promise<Operative> => {
      const wire = await request<WireOperative>('PATCH', `/api/operatives/${encId(operativeId)}`, {
        body: encodeParams({ ...updateParams }),
      });
      return decodeOperative(wire);
    },

    delete: async (operativeId: string): Promise<void> => {
      await request<unknown>('DELETE', `/api/operatives/${encId(operativeId)}`);
    },

    files: {
      list: async (operativeId: string): Promise<readonly OperativeFile[]> => {
        const items = await request<readonly WireIntel[]>(
          'GET',
          `/api/operatives/${encId(operativeId)}/intel`
        );
        return items.map(decodeFile);
      },

      add: async (
        operativeId: string,
        addParams: OperativeAddFilesParams
      ): Promise<readonly OperativeFile[]> => {
        const results: OperativeFile[] = [];
        for (const path of addParams.paths) {
          const wire = await request<WireIntel>(
            'POST',
            `/api/operatives/${encId(operativeId)}/intel`,
            {
              body: { sourceId: path },
            }
          );
          results.push(decodeFile(wire));
        }
        return results;
      },

      remove: async (operativeId: string, linkId: string): Promise<void> => {
        await request<unknown>(
          'DELETE',
          `/api/operatives/${encId(operativeId)}/intel/${encId(linkId)}`
        );
      },
    },

    skills: {
      list: async (operativeId: string): Promise<readonly OperativeSkill[]> => {
        const result = await request<WireEquipmentList>(
          'GET',
          `/api/operatives/${encId(operativeId)}/equipment`
        );
        return result.items.filter((e) => e.equipmentType === 'skill').map(decodeSkill);
      },

      add: async (
        operativeId: string,
        addParams: OperativeAddSkillsParams
      ): Promise<readonly OperativeSkill[]> => {
        const results: OperativeSkill[] = [];
        for (const refId of addParams.refIds) {
          const wire = await request<WireEquipment>(
            'POST',
            `/api/operatives/${encId(operativeId)}/equipment`,
            {
              body: { equipmentType: 'skill', refId },
            }
          );
          results.push(decodeSkill(wire));
        }
        return results;
      },

      remove: async (operativeId: string, linkId: string): Promise<void> => {
        await request<unknown>(
          'DELETE',
          `/api/operatives/${encId(operativeId)}/equipment/${encId(linkId)}`
        );
      },
    },

    tools: {
      list: async (operativeId: string): Promise<readonly OperativeTool[]> => {
        const result = await request<WireEquipmentList>(
          'GET',
          `/api/operatives/${encId(operativeId)}/equipment`
        );
        return result.items.filter((e) => e.equipmentType === 'mcp_tool').map(decodeTool);
      },

      add: async (
        operativeId: string,
        addParams: OperativeAddToolsParams
      ): Promise<readonly OperativeTool[]> => {
        const results: OperativeTool[] = [];
        for (const selector of addParams.selectors) {
          const wire = await request<WireEquipment>(
            'POST',
            `/api/operatives/${encId(operativeId)}/equipment`,
            {
              body: { equipmentType: 'mcp_tool', selector },
            }
          );
          results.push(decodeTool(wire));
        }
        return results;
      },

      remove: async (operativeId: string, linkId: string): Promise<void> => {
        await request<unknown>(
          'DELETE',
          `/api/operatives/${encId(operativeId)}/equipment/${encId(linkId)}`
        );
      },
    },
  };
};
