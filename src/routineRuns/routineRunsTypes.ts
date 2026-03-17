// Routine execution run domain types -- camelCase, readonly, no wire conversion needed.
// The app-service REST API already returns camelCase.

// -- Enums / unions --

export type RoutineRunStatus = 'running' | 'completed' | 'failed';

export type RoutineRunErrorTag =
  | 'RoutineNotFound'
  | 'RoutineNotActive'
  | 'ProjectNotFound'
  | 'ProjectNotOwned'
  | 'OperativeNotFound'
  | 'ExecutionFailed'
  | 'AlreadyRunning';

// -- Domain models --

export type RoutineRun = {
  readonly id: string;
  readonly runId: string;
  readonly routineSlug: string;
  readonly projectSlug: string;
  readonly operativeSlug: string;
  readonly sessionId: string | null;
  readonly status: RoutineRunStatus;
  readonly summary: string | null;
  readonly errorTag: RoutineRunErrorTag | null;
  readonly errorMessage: string | null;
  readonly durationMs: number | null;
  readonly createdAt: string;
  readonly completedAt: string | null;
};

// -- Params --

export type RoutineRunListParams = {
  readonly routineSlug: string;
  readonly scope?: 'workspace' | 'project';
  readonly projectName?: string;
};

export type RoutineRunGetParams = {
  readonly routineSlug: string;
  readonly executionId: string;
};

// -- Client interface --

/**
 * Routine execution runs REST client.
 *
 * Obtain via `diskd.platform.routineRuns({ auth })`.
 * Maps to the app-service `/api/routines/:slug/executions` endpoints.
 */
export type RoutineRunsClient = {
  /** GET /api/routines/:slug/executions -- list execution runs for a routine. */
  readonly list: (params: RoutineRunListParams) => Promise<readonly RoutineRun[]>;
  /** GET /api/routines/:slug/executions/:executionId -- get a single run. */
  readonly get: (params: RoutineRunGetParams) => Promise<RoutineRun>;
};
