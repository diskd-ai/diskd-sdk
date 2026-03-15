// Operative domain types.
// Wire mapping (intelAccess -> fileAccess, sourceId -> path, equipmentType hidden)
// is handled in the client factory.

// -- Enums / unions --

export type OperativeEngine = 'quick' | 'deep';
export type OperativeFileAccess = 'all' | 'selected';
export type OperativeStatus = 'active' | 'standby';
export type OperativeTrustLevel = 0 | 1 | 2 | 3;

// -- Domain models --

export type Operative = {
  readonly id: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly slug: string;
  readonly avatarUrl?: string;
  readonly engineProvider?: string;
  readonly engineModel?: string;
  readonly engine: OperativeEngine;
  readonly orders: string;
  readonly ordersUpdatedAt?: string;
  readonly fileAccess: OperativeFileAccess;
  readonly trustLevel: OperativeTrustLevel;
  readonly isPrimary: boolean;
  readonly status: OperativeStatus;
  readonly sealGradient?: readonly [string, string];
  readonly createdBy?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type OperativeFile = {
  readonly id: string;
  readonly operativeId: string;
  /** Drive path relative to the operative's project chroot. */
  readonly path: string;
  readonly createdAt: string;
};

export type OperativeSkill = {
  readonly id: string;
  readonly operativeId: string;
  readonly refId: string;
  readonly createdAt: string;
};

export type OperativeTool = {
  readonly id: string;
  readonly operativeId: string;
  readonly selector: string;
  readonly display?: {
    readonly serverName: string;
    readonly toolName: string;
  };
  readonly resolutionStatus?: 'valid' | 'disabled_globally' | 'unknown';
  readonly createdAt: string;
};

// -- Params --

export type OperativeListParams = {
  readonly projectId: string;
};

export type OperativeGetBySlugParams = {
  readonly projectId: string;
  readonly slug: string;
};

export type OperativeCreateParams = {
  readonly projectId: string;
  readonly name: string;
  readonly slug?: string;
  readonly orders?: string;
  readonly engineProvider?: string;
  readonly engineModel?: string;
  readonly engine?: OperativeEngine;
};

export type OperativeUpdateParams = {
  readonly name?: string;
  readonly slug?: string;
  readonly avatarUrl?: string;
  readonly engineProvider?: string;
  readonly engineModel?: string;
  readonly engine?: OperativeEngine;
  readonly orders?: string;
  readonly ordersUpdatedAt?: string;
  readonly fileAccess?: OperativeFileAccess;
  readonly trustLevel?: OperativeTrustLevel;
  readonly status?: OperativeStatus;
  readonly sealGradient?: readonly [string, string];
};

export type OperativeAddFilesParams = {
  /** Drive paths relative to the operative's project chroot. */
  readonly paths: readonly string[];
};

export type OperativeAddSkillsParams = {
  readonly refIds: readonly string[];
};

export type OperativeAddToolsParams = {
  readonly selectors: readonly string[];
};

// -- Client interface --

/**
 * Operatives REST client with files, skills, and tools sub-namespaces.
 *
 * Obtain via `diskd.platform.operatives({ auth })`.
 * Maps to the app-service `/api/operatives` endpoints.
 */
export type OperativesClient = {
  /** GET /api/operatives?projectId=... -- list operatives in a project. */
  readonly list: (params: OperativeListParams) => Promise<readonly Operative[]>;
  /** GET /api/operatives/:operativeId -- get a single operative by id. */
  readonly get: (operativeId: string) => Promise<Operative>;
  /** GET /api/operatives/by-slug?projectId=...&slug=... -- get by slug within a project. */
  readonly getBySlug: (params: OperativeGetBySlugParams) => Promise<Operative>;
  /** POST /api/operatives -- create a new operative. */
  readonly create: (params: OperativeCreateParams) => Promise<Operative>;
  /** PATCH /api/operatives/:operativeId -- update an existing operative. */
  readonly update: (operativeId: string, params: OperativeUpdateParams) => Promise<Operative>;
  /** DELETE /api/operatives/:operativeId -- delete an operative. */
  readonly delete: (operativeId: string) => Promise<void>;

  /** Drive files attached to the operative (knowledge sources). */
  readonly files: {
    readonly list: (operativeId: string) => Promise<readonly OperativeFile[]>;
    readonly add: (operativeId: string, params: OperativeAddFilesParams) => Promise<readonly OperativeFile[]>;
    readonly remove: (operativeId: string, linkId: string) => Promise<void>;
  };

  /** Skills attached to the operative. */
  readonly skills: {
    readonly list: (operativeId: string) => Promise<readonly OperativeSkill[]>;
    readonly add: (operativeId: string, params: OperativeAddSkillsParams) => Promise<readonly OperativeSkill[]>;
    readonly remove: (operativeId: string, linkId: string) => Promise<void>;
  };

  /** MCP tools attached to the operative. */
  readonly tools: {
    readonly list: (operativeId: string) => Promise<readonly OperativeTool[]>;
    readonly add: (operativeId: string, params: OperativeAddToolsParams) => Promise<readonly OperativeTool[]>;
    readonly remove: (operativeId: string, linkId: string) => Promise<void>;
  };
};
