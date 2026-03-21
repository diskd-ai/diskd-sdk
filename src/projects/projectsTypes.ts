// Project domain types -- camelCase, readonly, no wire conversion needed.
// The app-service REST API already returns camelCase.

// -- Domain models --

export type Project = {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly icon?: string;
  readonly iconColor?: string;
  readonly updatedAt: string;
};

export type ProjectDetailed = {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly icon?: string;
  readonly iconColor?: string;
  readonly updatedAt: string;
};

// -- Params --

export type ProjectCreateParams = {
  readonly name: string;
  readonly description?: string;
  readonly icon?: string;
  readonly iconColor?: string;
};

export type ProjectUpdateParams = {
  readonly name?: string;
  readonly description?: string;
  readonly icon?: string;
  readonly iconColor?: string;
};

// -- Client interface --

/**
 * Projects REST client.
 *
 * Obtain via `diskd.platform.projects({ auth })`.
 * Maps to the app-service `/api/projects` endpoints.
 */
export type ProjectsClient = {
  /** GET /api/projects -- list all projects. */
  readonly list: () => Promise<readonly Project[]>;
  /** GET /api/projects/:projectId -- get a single project by id. */
  readonly get: (projectId: string) => Promise<ProjectDetailed>;
  /** POST /api/projects -- create a new project. */
  readonly create: (params: ProjectCreateParams) => Promise<Project>;
  /** PUT /api/projects/:projectId -- update an existing project. */
  readonly update: (projectId: string, params: ProjectUpdateParams) => Promise<Project>;
  /** DELETE /api/projects/:projectId -- delete a project. */
  readonly delete: (projectId: string) => Promise<void>;
};
