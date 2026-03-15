import assert from 'node:assert/strict';
import test from 'node:test';

import { createDriveCrontabClient } from '../drive/crontab.js';

type RpcCall = { readonly method: string; readonly params: unknown };

const makeRpcMock = (response: unknown) => {
  const calls: RpcCall[] = [];
  const call = async (method: string, params: unknown): Promise<unknown> => {
    calls.push({ method, params });
    return response;
  };
  return { calls, call };
};

const makeRpcSequenceMock = (responses: readonly unknown[]) => {
  const calls: RpcCall[] = [];
  let index = 0;
  const call = async (method: string, params: unknown): Promise<unknown> => {
    calls.push({ method, params });
    const response = responses[index];
    index += 1;
    if (response instanceof Error) {
      throw response;
    }
    return response;
  };
  return { calls, call };
};

test('crontab client save encodes project scope and request payload', async () => {
  const { calls, call } = makeRpcMock({
    job_count: 1,
    next_run_at: '2026-03-13T10:05:00Z',
    updated_at: '2026-03-13T10:00:00Z',
  });

  const client = createDriveCrontabClient({ call });
  await client.save({
    scope: {
      scopeType: 'project',
      projectId: 'proj-1',
    },
    document: {
      version: 1,
      timezone: 'UTC',
      jobs: [
        {
          jobId: '01JABCD2FGH3JK4MNP5QRST6VW',
          enabled: true,
          schedule: {
            minute: '*/5',
            hour: '*',
            dayOfMonth: '*',
            month: '*',
            dayOfWeek: '*',
          },
          request: {
            method: 'POST',
            url: 'https://example.internal/hooks/sync',
            payload: {
              kind: 'json',
              value: {
                routine_id: 'nightly-sync',
              },
            },
          },
        },
      ],
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, 'drive/crontab/save');
  assert.deepEqual(calls[0]?.params, {
    scope: {
      scope_type: 'project',
      project_id: 'proj-1',
    },
    document: {
      version: 1,
      timezone: 'UTC',
      jobs: [
        {
          job_id: '01JABCD2FGH3JK4MNP5QRST6VW',
          enabled: true,
          schedule: {
            minute: '*/5',
            hour: '*',
            day_of_month: '*',
            month: '*',
            day_of_week: '*',
          },
          request: {
            method: 'POST',
            url: 'https://example.internal/hooks/sync',
            payload: {
              kind: 'json',
              value: {
                routine_id: 'nightly-sync',
              },
            },
          },
        },
      ],
    },
  });
});

test('crontab client get decodes document response', async () => {
  const { call } = makeRpcMock({
    document: {
      version: 1,
      timezone: 'UTC',
      jobs: [
        {
          job_id: '01JABCD2FGH3JK4MNP5QRST6VX',
          enabled: false,
          schedule: {
            minute: '0',
            hour: '9',
            day_of_month: '*',
            month: '*',
            day_of_week: '1',
          },
          request: {
            method: 'GET',
            url: 'https://example.internal/reports/weekly',
          },
        },
      ],
    },
    job_count: 1,
    next_run_at: null,
    updated_at: '2026-03-13T10:00:00Z',
  });

  const client = createDriveCrontabClient({ call });
  const result = await client.get({
    scope: {
      scopeType: 'profile',
    },
  });

  assert.deepEqual(result, {
    document: {
      version: 1,
      timezone: 'UTC',
      jobs: [
        {
          jobId: '01JABCD2FGH3JK4MNP5QRST6VX',
          enabled: false,
          schedule: {
            minute: '0',
            hour: '9',
            dayOfMonth: '*',
            month: '*',
            dayOfWeek: '1',
          },
          request: {
            method: 'GET',
            url: 'https://example.internal/reports/weekly',
            payload: null,
          },
        },
      ],
    },
    jobCount: 1,
    nextRunAt: null,
    updatedAt: '2026-03-13T10:00:00Z',
  });
});

test('crontab client listJobs and runJob decode scheduler metadata', async () => {
  const listMock = makeRpcMock({
    items: [
      {
        job_id: '01JABCD2FGH3JK4MNP5QRST6VY',
        enabled: true,
        schedule: {
          minute: '0',
          hour: '*',
          day_of_month: '*',
          month: '*',
          day_of_week: '*',
        },
        method: 'PUT',
        url: 'https://example.internal/sync',
        payload_source: 'uri',
        next_run_at: '2026-03-13T11:00:00Z',
        last_run_at: '2026-03-13T10:00:00Z',
        last_http_status: 200,
        last_error_summary: null,
      },
    ],
  });
  const runMock = makeRpcMock({
    job_id: '01JABCD2FGH3JK4MNP5QRST6VY',
    executed_at: '2026-03-13T10:05:00Z',
    last_http_status: 200,
    last_error_summary: null,
  });

  const listClient = createDriveCrontabClient({ call: listMock.call });
  const runClient = createDriveCrontabClient({ call: runMock.call });

  const listResult = await listClient.listJobs({
    scope: {
      scopeType: 'profile',
    },
  });
  const runResult = await runClient.runJob({
    jobId: '01JABCD2FGH3JK4MNP5QRST6VY',
  });

  assert.deepEqual(listResult, {
    items: [
      {
        jobId: '01JABCD2FGH3JK4MNP5QRST6VY',
        enabled: true,
        schedule: {
          minute: '0',
          hour: '*',
          dayOfMonth: '*',
          month: '*',
          dayOfWeek: '*',
        },
        method: 'PUT',
        url: 'https://example.internal/sync',
        payloadSource: 'uri',
        nextRunAt: '2026-03-13T11:00:00Z',
        lastRunAt: '2026-03-13T10:00:00Z',
        lastHttpStatus: 200,
        lastErrorSummary: null,
      },
    ],
  });
  assert.deepEqual(runResult, {
    jobId: '01JABCD2FGH3JK4MNP5QRST6VY',
    executedAt: '2026-03-13T10:05:00Z',
    lastHttpStatus: 200,
    lastErrorSummary: null,
  });
  assert.equal(runMock.calls[0]?.method, 'drive/crontab/run-job');
  assert.deepEqual(runMock.calls[0]?.params, {
    job_id: '01JABCD2FGH3JK4MNP5QRST6VY',
  });
});

test('crontab client createProjectJob creates a new document when none exists', async () => {
  const { calls, call } = makeRpcSequenceMock([
    new Error('JSON-RPC HTTP 404: {"data":{"domain_code":"CRONTAB_NOT_FOUND"}}'),
    {
      job_count: 1,
      next_run_at: null,
      updated_at: '2026-03-13T10:00:00Z',
    },
  ]);

  const client = createDriveCrontabClient({ call });
  const result = await client.createProjectJob({
    projectId: 'proj-1',
    timezone: 'UTC',
    job: {
      jobId: '01JABCD2FGH3JK4MNP5QRST6W0',
      enabled: true,
      schedule: {
        minute: '0',
        hour: '*',
        dayOfMonth: '*',
        month: '*',
        dayOfWeek: '*',
      },
      request: {
        method: 'POST',
        url: 'https://example.internal/hooks/project',
        payload: null,
      },
    },
  });

  assert.deepEqual(result, {
    jobCount: 1,
    nextRunAt: null,
    updatedAt: '2026-03-13T10:00:00Z',
  });
  assert.equal(calls[0]?.method, 'drive/crontab/get');
  assert.equal(calls[1]?.method, 'drive/crontab/save');
  assert.deepEqual(calls[1]?.params, {
    scope: {
      scope_type: 'project',
      project_id: 'proj-1',
    },
    document: {
      version: 1,
      timezone: 'UTC',
      jobs: [
        {
          job_id: '01JABCD2FGH3JK4MNP5QRST6W0',
          enabled: true,
          schedule: {
            minute: '0',
            hour: '*',
            day_of_month: '*',
            month: '*',
            day_of_week: '*',
          },
          request: {
            method: 'POST',
            url: 'https://example.internal/hooks/project',
          },
        },
      ],
    },
  });
});

test('crontab client createProfileJob upserts into the existing document', async () => {
  const { calls, call } = makeRpcSequenceMock([
    {
      document: {
        version: 1,
        timezone: 'Europe/Paris',
        jobs: [
          {
            job_id: '01JABCD2FGH3JK4MNP5QRST6W1',
            enabled: true,
            schedule: {
              minute: '15',
              hour: '*',
              day_of_month: '*',
              month: '*',
              day_of_week: '*',
            },
            request: {
              method: 'GET',
              url: 'https://example.internal/existing',
            },
          },
        ],
      },
      job_count: 1,
      next_run_at: '2026-03-13T10:15:00Z',
      updated_at: '2026-03-13T10:00:00Z',
    },
    {
      job_count: 2,
      next_run_at: '2026-03-13T10:15:00Z',
      updated_at: '2026-03-13T10:01:00Z',
    },
  ]);

  const client = createDriveCrontabClient({ call });
  await client.createProfileJob({
    job: {
      jobId: '01JABCD2FGH3JK4MNP5QRST6W2',
      enabled: false,
      schedule: {
        minute: '30',
        hour: '9',
        dayOfMonth: '*',
        month: '*',
        dayOfWeek: '1',
      },
      request: {
        method: 'PUT',
        url: 'https://example.internal/new',
        payload: {
          kind: 'path',
          path: 'payloads/new.json',
        },
      },
    },
  });

  assert.equal(calls[0]?.method, 'drive/crontab/get');
  assert.equal(calls[1]?.method, 'drive/crontab/save');
  assert.deepEqual(calls[1]?.params, {
    scope: {
      scope_type: 'profile',
    },
    document: {
      version: 1,
      timezone: 'Europe/Paris',
      jobs: [
        {
          job_id: '01JABCD2FGH3JK4MNP5QRST6W1',
          enabled: true,
          schedule: {
            minute: '15',
            hour: '*',
            day_of_month: '*',
            month: '*',
            day_of_week: '*',
          },
          request: {
            method: 'GET',
            url: 'https://example.internal/existing',
          },
        },
        {
          job_id: '01JABCD2FGH3JK4MNP5QRST6W2',
          enabled: false,
          schedule: {
            minute: '30',
            hour: '9',
            day_of_month: '*',
            month: '*',
            day_of_week: '1',
          },
          request: {
            method: 'PUT',
            url: 'https://example.internal/new',
            payload: {
              kind: 'path',
              path: 'payloads/new.json',
            },
          },
        },
      ],
    },
  });
});
