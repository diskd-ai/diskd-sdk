// Routine domain types -- camelCase, readonly, no wire conversion needed.
// The app-service REST API already returns camelCase.

// -- Enums / unions --

export type RoutineStatus = 'active' | 'paused' | 'draft';
export type RoutineTriggerType = 'rhythm' | 'signal';
export type RoutineScope = 'workspace' | 'project';

export type RoutineScopeRef =
  | { readonly scopeType: 'workspace' }
  | { readonly scopeType: 'project'; readonly projectName: string };

// -- Rhythms (discriminated union) --

export type CrontabRhythm = {
  readonly kind: 'crontab';
  readonly jobId: string;
  readonly schedule: {
    readonly minute: string;
    readonly hour: string;
    readonly dayOfMonth: string;
    readonly month: string;
    readonly dayOfWeek: string;
  };
};

export type SignalRhythm = {
  readonly kind: 'signal';
  readonly eventName: string;
  readonly payload?: Readonly<Record<string, string>>;
};

export type Rhythm = CrontabRhythm | SignalRhythm;

// -- Domain models --

export type RoutineStep = {
  readonly id: string;
  readonly name: string;
  readonly action: string;
  readonly order: number;
};

export type Routine = {
  readonly slug: string;
  readonly name: string;
  readonly description?: string;
  readonly icon: string;
  readonly status: RoutineStatus;
  readonly triggerType: RoutineTriggerType;
  readonly trigger: Readonly<Record<string, string>>;
  readonly steps: readonly RoutineStep[];
  readonly operativeSlug: string;
  readonly projectSlug?: string;
  readonly rhythms: readonly Rhythm[];
  readonly scope: RoutineScope;
  readonly projectName?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

// -- Params --

export type RoutineCreateParams = {
  readonly name: string;
  readonly description?: string;
  readonly icon?: string;
  readonly status?: RoutineStatus;
  readonly triggerType?: RoutineTriggerType;
  readonly trigger?: Readonly<Record<string, string>>;
  readonly steps?: readonly RoutineStep[];
  readonly operativeSlug: string;
  readonly projectSlug?: string;
  readonly scope?: RoutineScope;
  readonly projectName?: string;
};

export type RoutineUpdateParams = {
  readonly name?: string;
  readonly description?: string;
  readonly icon?: string;
  readonly status?: RoutineStatus;
  readonly triggerType?: RoutineTriggerType;
  readonly trigger?: Readonly<Record<string, string>>;
  readonly steps?: readonly RoutineStep[];
  readonly operativeSlug?: string;
  readonly projectSlug?: string;
};

export type RoutineListParams = {
  readonly scope?: RoutineScope;
  readonly projectName?: string;
};

export type RoutineGetParams = {
  readonly slug: string;
  readonly scope?: RoutineScope;
  readonly projectName?: string;
};

export type RoutineDeleteParams = {
  readonly slug: string;
  readonly scope?: RoutineScope;
  readonly projectName?: string;
};

// -- Client interface --

/**
 * Routines REST client.
 *
 * Obtain via `diskd.platform.routines({ auth })`.
 * Maps to the app-service `/api/routines` endpoints.
 */
export type RoutinesClient = {
  /** GET /api/routines -- list routines in a given scope. */
  readonly list: (params?: RoutineListParams) => Promise<readonly Routine[]>;
  /** GET /api/routines/:slug -- get a single routine by slug. */
  readonly get: (params: RoutineGetParams) => Promise<Routine>;
  /** POST /api/routines -- create a new routine. */
  readonly create: (params: RoutineCreateParams) => Promise<Routine>;
  /** PATCH /api/routines/:slug -- update an existing routine. */
  readonly update: (
    slug: string,
    params: RoutineUpdateParams,
    scope?: RoutineScopeRef
  ) => Promise<Routine>;
  /** DELETE /api/routines/:slug -- soft-delete a routine. */
  readonly delete: (params: RoutineDeleteParams) => Promise<void>;
};
