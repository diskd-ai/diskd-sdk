import type { JsonObject, JsonValue } from './sessionTypes.js';

export type DriveCrontabHttpMethod = 'DELETE' | 'GET' | 'POST' | 'PUT';
export type DriveCrontabPayloadKind = 'json' | 'path' | 'uri';
export type DriveCrontabJsonContainer = JsonObject | readonly JsonValue[];

export type DriveCrontabProfileScopeRef = {
  readonly scopeType: 'profile';
};

export type DriveCrontabProjectScopeRef = {
  readonly scopeType: 'project';
  readonly projectId: string;
};

export type DriveCrontabScopeRef =
  | DriveCrontabProfileScopeRef
  | DriveCrontabProjectScopeRef;

export type DriveCrontabSchedule = {
  readonly minute: string;
  readonly hour: string;
  readonly dayOfMonth: string;
  readonly month: string;
  readonly dayOfWeek: string;
};

export type DriveCrontabJsonPayload = {
  readonly kind: 'json';
  readonly value: DriveCrontabJsonContainer;
};

export type DriveCrontabPathPayload = {
  readonly kind: 'path';
  readonly path: string;
};

export type DriveCrontabUriPayload = {
  readonly kind: 'uri';
  readonly uri: string;
};

export type DriveCrontabPayload =
  | DriveCrontabJsonPayload
  | DriveCrontabPathPayload
  | DriveCrontabUriPayload;

export type DriveCrontabRequest = {
  readonly method: DriveCrontabHttpMethod;
  readonly url: string;
  readonly payload: DriveCrontabPayload | null;
};

export type DriveCrontabJob = {
  readonly jobId: string;
  readonly enabled: boolean;
  readonly schedule: DriveCrontabSchedule;
  readonly request: DriveCrontabRequest;
};

export type DriveCrontabDocument = {
  readonly version: 1;
  readonly timezone: string | null;
  readonly jobs: readonly DriveCrontabJob[];
};

export type DriveCrontabSaveParams = {
  readonly scope: DriveCrontabScopeRef;
  readonly document: DriveCrontabDocument;
};

export type DriveCrontabSaveResult = {
  readonly jobCount: number;
  readonly nextRunAt: string | null;
  readonly updatedAt: string;
};

export type DriveCrontabGetParams = {
  readonly scope: DriveCrontabScopeRef;
};

export type DriveCrontabGetResult = {
  readonly document: DriveCrontabDocument;
  readonly jobCount: number;
  readonly nextRunAt: string | null;
  readonly updatedAt: string;
};

export type DriveCrontabGetStatusParams = {
  readonly scope: DriveCrontabScopeRef;
};

export type DriveCrontabGetStatusResult = {
  readonly jobCount: number;
  readonly nextRunAt: string | null;
  readonly updatedAt: string;
};

export type DriveCrontabCreateProjectJobParams = {
  readonly projectId: string;
  readonly job: DriveCrontabJob;
  readonly timezone?: string | null;
};

export type DriveCrontabCreateProfileJobParams = {
  readonly job: DriveCrontabJob;
  readonly timezone?: string | null;
};

export type DriveCrontabListJobsParams = {
  readonly scope: DriveCrontabScopeRef;
};

export type DriveCrontabJobListItem = {
  readonly jobId: string;
  readonly enabled: boolean;
  readonly schedule: DriveCrontabSchedule;
  readonly method: DriveCrontabHttpMethod;
  readonly url: string;
  readonly payloadSource: DriveCrontabPayloadKind;
  readonly nextRunAt: string;
  readonly lastRunAt: string | null;
  readonly lastHttpStatus: number | null;
  readonly lastErrorSummary: string | null;
};

export type DriveCrontabListJobsResult = {
  readonly items: readonly DriveCrontabJobListItem[];
};

export type DriveCrontabRunJobParams = {
  readonly jobId: string;
};

export type DriveCrontabRunJobResult = {
  readonly jobId: string;
  readonly executedAt: string;
  readonly lastHttpStatus: number | null;
  readonly lastErrorSummary: string | null;
};

export type DriveCrontabClient = {
  readonly save: (params: DriveCrontabSaveParams) => Promise<DriveCrontabSaveResult>;
  readonly get: (params: DriveCrontabGetParams) => Promise<DriveCrontabGetResult>;
  readonly getStatus: (params: DriveCrontabGetStatusParams) => Promise<DriveCrontabGetStatusResult>;
  readonly createProjectJob: (params: DriveCrontabCreateProjectJobParams) => Promise<DriveCrontabSaveResult>;
  readonly createProfileJob: (params: DriveCrontabCreateProfileJobParams) => Promise<DriveCrontabSaveResult>;
  readonly listJobs: (params: DriveCrontabListJobsParams) => Promise<DriveCrontabListJobsResult>;
  readonly runJob: (params: DriveCrontabRunJobParams) => Promise<DriveCrontabRunJobResult>;
};
