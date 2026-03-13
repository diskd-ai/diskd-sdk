import type {
  DriveCrontabClient,
  DriveCrontabCreateProfileJobParams,
  DriveCrontabCreateProjectJobParams,
  DriveCrontabDocument,
  DriveCrontabGetParams,
  DriveCrontabGetResult,
  DriveCrontabGetStatusParams,
  DriveCrontabGetStatusResult,
  DriveCrontabHttpMethod,
  DriveCrontabJsonContainer,
  DriveCrontabJob,
  DriveCrontabJobListItem,
  DriveCrontabListJobsParams,
  DriveCrontabListJobsResult,
  DriveCrontabPayload,
  DriveCrontabPayloadKind,
  DriveCrontabRequest,
  DriveCrontabRunJobParams,
  DriveCrontabRunJobResult,
  DriveCrontabSaveParams,
  DriveCrontabSaveResult,
  DriveCrontabSchedule,
  DriveCrontabScopeRef,
} from './crontabTypes.js';

type UnknownObject = { readonly [key: string]: unknown };
type RpcCall = (method: string, rpcParams: unknown) => Promise<unknown>;

const HTTP_METHODS = new Set<DriveCrontabHttpMethod>(['DELETE', 'GET', 'POST', 'PUT']);
const PAYLOAD_KINDS = new Set<DriveCrontabPayloadKind>(['json', 'path', 'uri']);

const isObject = (value: unknown): value is UnknownObject =>
  typeof value === 'object' && value !== null;

const hasOwn = (obj: UnknownObject, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(obj, key);

const readField = (obj: UnknownObject, snakeKey: string, camelKey: string): unknown =>
  hasOwn(obj, snakeKey) ? obj[snakeKey] : obj[camelKey];

const readRequiredNonEmptyString = (obj: UnknownObject, snakeKey: string, camelKey: string): string => {
  const value = readField(obj, snakeKey, camelKey);
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid Drive crontab payload: '${snakeKey}' must be a non-empty string`);
  }
  return value;
};

const readNullableString = (obj: UnknownObject, snakeKey: string, camelKey: string): string | null => {
  const value = readField(obj, snakeKey, camelKey);
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new Error(`Invalid Drive crontab payload: '${snakeKey}' must be a string or null`);
  }
  return value;
};

const readNullableNumber = (obj: UnknownObject, snakeKey: string, camelKey: string): number | null => {
  const value = readField(obj, snakeKey, camelKey);
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number') {
    throw new Error(`Invalid Drive crontab payload: '${snakeKey}' must be a number or null`);
  }
  return value;
};

const readRequiredNumber = (obj: UnknownObject, snakeKey: string, camelKey: string): number => {
  const value = readField(obj, snakeKey, camelKey);
  if (typeof value !== 'number') {
    throw new Error(`Invalid Drive crontab payload: '${snakeKey}' must be a number`);
  }
  return value;
};

const readRequiredBoolean = (obj: UnknownObject, snakeKey: string, camelKey: string): boolean => {
  const value = readField(obj, snakeKey, camelKey);
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid Drive crontab payload: '${snakeKey}' must be a boolean`);
  }
  return value;
};

const readRequiredArray = (obj: UnknownObject, snakeKey: string, camelKey: string): readonly unknown[] => {
  const value = readField(obj, snakeKey, camelKey);
  if (!Array.isArray(value)) {
    throw new Error(`Invalid Drive crontab payload: '${snakeKey}' must be an array`);
  }
  return value;
};

const readRequiredHttpMethod = (
  obj: UnknownObject,
  snakeKey: string,
  camelKey: string,
): DriveCrontabHttpMethod => {
  const value = readField(obj, snakeKey, camelKey);
  if (typeof value !== 'string' || !HTTP_METHODS.has(value as DriveCrontabHttpMethod)) {
    throw new Error(`Invalid Drive crontab payload: '${snakeKey}' must be a supported HTTP method`);
  }
  return value as DriveCrontabHttpMethod;
};

const readRequiredPayloadKind = (
  obj: UnknownObject,
  snakeKey: string,
  camelKey: string,
): DriveCrontabPayloadKind => {
  const value = readField(obj, snakeKey, camelKey);
  if (typeof value !== 'string' || !PAYLOAD_KINDS.has(value as DriveCrontabPayloadKind)) {
    throw new Error(`Invalid Drive crontab payload: '${snakeKey}' must be a supported payload kind`);
  }
  return value as DriveCrontabPayloadKind;
};

const tryParseJsonObject = (value: string): UnknownObject | null => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isObject(parsed) && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const isCrontabNotFoundError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const jsonStart = error.message.indexOf('{');
  if (jsonStart < 0) return false;
  const payload = tryParseJsonObject(error.message.slice(jsonStart));
  if (!payload) return false;
  const data = payload.data;
  if (!isObject(data) || Array.isArray(data)) return false;
  return data.domain_code === 'CRONTAB_NOT_FOUND';
};

const decodeSchedule = (raw: unknown): DriveCrontabSchedule => {
  if (!isObject(raw) || Array.isArray(raw)) {
    throw new Error('Invalid Drive crontab schedule: expected object');
  }

  return {
    minute: readRequiredNonEmptyString(raw, 'minute', 'minute'),
    hour: readRequiredNonEmptyString(raw, 'hour', 'hour'),
    dayOfMonth: readRequiredNonEmptyString(raw, 'day_of_month', 'dayOfMonth'),
    month: readRequiredNonEmptyString(raw, 'month', 'month'),
    dayOfWeek: readRequiredNonEmptyString(raw, 'day_of_week', 'dayOfWeek'),
  };
};

const encodeSchedule = (schedule: DriveCrontabSchedule): unknown => ({
  minute: schedule.minute,
  hour: schedule.hour,
  day_of_month: schedule.dayOfMonth,
  month: schedule.month,
  day_of_week: schedule.dayOfWeek,
});

const decodePayload = (raw: unknown): DriveCrontabPayload => {
  if (!isObject(raw) || Array.isArray(raw)) {
    throw new Error('Invalid Drive crontab payload: expected object');
  }

  const kind = readRequiredPayloadKind(raw, 'kind', 'kind');
  if (kind === 'json') {
    const value = readField(raw, 'value', 'value');
    if (!isObject(value) && !Array.isArray(value)) {
      throw new Error("Invalid Drive crontab payload: 'value' must be an object or array");
    }
    return {
      kind: 'json',
      value: value as DriveCrontabJsonContainer,
    };
  }

  if (kind === 'path') {
    return {
      kind: 'path',
      path: readRequiredNonEmptyString(raw, 'path', 'path'),
    };
  }

  return {
    kind: 'uri',
    uri: readRequiredNonEmptyString(raw, 'uri', 'uri'),
  };
};

const encodePayload = (payload: DriveCrontabPayload): unknown => {
  if (payload.kind === 'json') {
    return {
      kind: 'json',
      value: payload.value,
    };
  }

  if (payload.kind === 'path') {
    return {
      kind: 'path',
      path: payload.path,
    };
  }

  return {
    kind: 'uri',
    uri: payload.uri,
  };
};

const decodeRequest = (raw: unknown): DriveCrontabRequest => {
  if (!isObject(raw) || Array.isArray(raw)) {
    throw new Error('Invalid Drive crontab request: expected object');
  }

  const payloadRaw = readField(raw, 'payload', 'payload');

  return {
    method: readRequiredHttpMethod(raw, 'method', 'method'),
    url: readRequiredNonEmptyString(raw, 'url', 'url'),
    payload: payloadRaw === undefined || payloadRaw === null ? null : decodePayload(payloadRaw),
  };
};

const encodeRequest = (request: DriveCrontabRequest): unknown => ({
  method: request.method,
  url: request.url,
  ...(request.payload !== null ? { payload: encodePayload(request.payload) } : {}),
});

const decodeJob = (raw: unknown): DriveCrontabJob => {
  if (!isObject(raw) || Array.isArray(raw)) {
    throw new Error('Invalid Drive crontab job: expected object');
  }

  return {
    jobId: readRequiredNonEmptyString(raw, 'job_id', 'jobId'),
    enabled: readRequiredBoolean(raw, 'enabled', 'enabled'),
    schedule: decodeSchedule(readField(raw, 'schedule', 'schedule')),
    request: decodeRequest(readField(raw, 'request', 'request')),
  };
};

const encodeJob = (job: DriveCrontabJob): unknown => ({
  job_id: job.jobId,
  enabled: job.enabled,
  schedule: encodeSchedule(job.schedule),
  request: encodeRequest(job.request),
});

const decodeDocument = (raw: unknown): DriveCrontabDocument => {
  if (!isObject(raw) || Array.isArray(raw)) {
    throw new Error('Invalid Drive crontab document: expected object');
  }

  const version = readRequiredNumber(raw, 'version', 'version');
  if (version !== 1) {
    throw new Error("Invalid Drive crontab document: 'version' must be 1");
  }

  return {
    version,
    timezone: readNullableString(raw, 'timezone', 'timezone'),
    jobs: readRequiredArray(raw, 'jobs', 'jobs').map(decodeJob),
  };
};

const encodeDocument = (document: DriveCrontabDocument): unknown => ({
  version: document.version,
  timezone: document.timezone,
  jobs: document.jobs.map(encodeJob),
});

const encodeScope = (scope: DriveCrontabScopeRef): unknown => {
  if (scope.scopeType === 'profile') {
    return { scope_type: 'profile' };
  }

  return {
    scope_type: 'project',
    project_id: scope.projectId,
  };
};

const upsertJob = (
  jobs: readonly DriveCrontabJob[],
  job: DriveCrontabJob,
): readonly DriveCrontabJob[] => {
  const existingIndex = jobs.findIndex((item) => item.jobId === job.jobId);
  if (existingIndex < 0) {
    return [...jobs, job];
  }
  return jobs.map((item, index) => index === existingIndex ? job : item);
};

const decodeSaveResult = (raw: unknown): DriveCrontabSaveResult => {
  if (!isObject(raw) || Array.isArray(raw)) throw new Error('Invalid drive/crontab/save result');
  return {
    jobCount: readRequiredNumber(raw, 'job_count', 'jobCount'),
    nextRunAt: readNullableString(raw, 'next_run_at', 'nextRunAt'),
    updatedAt: readRequiredNonEmptyString(raw, 'updated_at', 'updatedAt'),
  };
};

const decodeGetResult = (raw: unknown): DriveCrontabGetResult => {
  if (!isObject(raw) || Array.isArray(raw)) throw new Error('Invalid drive/crontab/get result');
  return {
    document: decodeDocument(readField(raw, 'document', 'document')),
    jobCount: readRequiredNumber(raw, 'job_count', 'jobCount'),
    nextRunAt: readNullableString(raw, 'next_run_at', 'nextRunAt'),
    updatedAt: readRequiredNonEmptyString(raw, 'updated_at', 'updatedAt'),
  };
};

const decodeGetStatusResult = (raw: unknown): DriveCrontabGetStatusResult => {
  if (!isObject(raw) || Array.isArray(raw)) throw new Error('Invalid drive/crontab/get-status result');
  return {
    jobCount: readRequiredNumber(raw, 'job_count', 'jobCount'),
    nextRunAt: readNullableString(raw, 'next_run_at', 'nextRunAt'),
    updatedAt: readRequiredNonEmptyString(raw, 'updated_at', 'updatedAt'),
  };
};

const decodeListJobItem = (raw: unknown): DriveCrontabJobListItem => {
  if (!isObject(raw) || Array.isArray(raw)) {
    throw new Error('Invalid drive/crontab/list-jobs item');
  }

  return {
    jobId: readRequiredNonEmptyString(raw, 'job_id', 'jobId'),
    enabled: readRequiredBoolean(raw, 'enabled', 'enabled'),
    schedule: decodeSchedule(readField(raw, 'schedule', 'schedule')),
    method: readRequiredHttpMethod(raw, 'method', 'method'),
    url: readRequiredNonEmptyString(raw, 'url', 'url'),
    payloadSource: readRequiredPayloadKind(raw, 'payload_source', 'payloadSource'),
    nextRunAt: readRequiredNonEmptyString(raw, 'next_run_at', 'nextRunAt'),
    lastRunAt: readNullableString(raw, 'last_run_at', 'lastRunAt'),
    lastHttpStatus: readNullableNumber(raw, 'last_http_status', 'lastHttpStatus'),
    lastErrorSummary: readNullableString(raw, 'last_error_summary', 'lastErrorSummary'),
  };
};

const decodeListJobsResult = (raw: unknown): DriveCrontabListJobsResult => {
  if (!isObject(raw) || Array.isArray(raw)) throw new Error('Invalid drive/crontab/list-jobs result');
  return {
    items: readRequiredArray(raw, 'items', 'items').map(decodeListJobItem),
  };
};

const decodeRunJobResult = (raw: unknown): DriveCrontabRunJobResult => {
  if (!isObject(raw) || Array.isArray(raw)) throw new Error('Invalid drive/crontab/run-job result');
  return {
    jobId: readRequiredNonEmptyString(raw, 'job_id', 'jobId'),
    executedAt: readRequiredNonEmptyString(raw, 'executed_at', 'executedAt'),
    lastHttpStatus: readNullableNumber(raw, 'last_http_status', 'lastHttpStatus'),
    lastErrorSummary: readNullableString(raw, 'last_error_summary', 'lastErrorSummary'),
  };
};

export const createDriveCrontabClient = (params: { readonly call: RpcCall }): DriveCrontabClient => {
  const save = async (clientParams: DriveCrontabSaveParams): Promise<DriveCrontabSaveResult> => {
    const result = await params.call('drive/crontab/save', {
      scope: encodeScope(clientParams.scope),
      document: encodeDocument(clientParams.document),
    });
    return decodeSaveResult(result);
  };

  const get = async (clientParams: DriveCrontabGetParams): Promise<DriveCrontabGetResult> => {
    const result = await params.call('drive/crontab/get', {
      scope: encodeScope(clientParams.scope),
    });
    return decodeGetResult(result);
  };

  const saveSingleJob = async (paramsForJob: {
    readonly scope: DriveCrontabScopeRef;
    readonly job: DriveCrontabJob;
    readonly timezone?: string | null;
  }): Promise<DriveCrontabSaveResult> => {
    let currentDocument: DriveCrontabDocument | null = null;
    try {
      currentDocument = (await get({ scope: paramsForJob.scope })).document;
    } catch (error) {
      if (!isCrontabNotFoundError(error)) {
        throw error;
      }
    }

    const nextDocument: DriveCrontabDocument = currentDocument ?? {
      version: 1,
      timezone: paramsForJob.timezone ?? null,
      jobs: [],
    };

    return save({
      scope: paramsForJob.scope,
      document: {
        version: nextDocument.version,
        timezone: paramsForJob.timezone !== undefined ? paramsForJob.timezone : nextDocument.timezone,
        jobs: upsertJob(nextDocument.jobs, paramsForJob.job),
      },
    });
  };

  return {
    save,

    get,

    getStatus: async (clientParams: DriveCrontabGetStatusParams): Promise<DriveCrontabGetStatusResult> => {
      const result = await params.call('drive/crontab/get-status', {
        scope: encodeScope(clientParams.scope),
      });
      return decodeGetStatusResult(result);
    },

    createProjectJob: async (clientParams: DriveCrontabCreateProjectJobParams): Promise<DriveCrontabSaveResult> => {
      return saveSingleJob({
        scope: {
          scopeType: 'project',
          projectId: clientParams.projectId,
        },
        job: clientParams.job,
        timezone: clientParams.timezone,
      });
    },

    createProfileJob: async (clientParams: DriveCrontabCreateProfileJobParams): Promise<DriveCrontabSaveResult> => {
      return saveSingleJob({
        scope: {
          scopeType: 'profile',
        },
        job: clientParams.job,
        timezone: clientParams.timezone,
      });
    },

    listJobs: async (clientParams: DriveCrontabListJobsParams): Promise<DriveCrontabListJobsResult> => {
      const result = await params.call('drive/crontab/list-jobs', {
        scope: encodeScope(clientParams.scope),
      });
      return decodeListJobsResult(result);
    },

    runJob: async (clientParams: DriveCrontabRunJobParams): Promise<DriveCrontabRunJobResult> => {
      const result = await params.call('drive/crontab/run-job', {
        job_id: clientParams.jobId,
      });
      return decodeRunJobResult(result);
    },
  };
};
