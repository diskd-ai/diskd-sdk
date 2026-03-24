/**
 * HTTP client for Platform Events.
 *
 * Publishes domain events via POST /publish to the app-service events endpoint,
 * which constructs an envelope and publishes to NATS JetStream directly.
 */
import type { AuthModule } from '../auth/types.js';
import { resolveDiskdGatewayUrl } from '../env/baseUrl.js';
import type {
  PlatformEventsClient,
  PublishEventError,
  PublishEventParams,
  PublishEventResult,
} from './platformEventsTypes.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type RawObject = { readonly [key: string]: unknown };

const isObject = (value: unknown): value is RawObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// ---------------------------------------------------------------------------
// Response decoding (pure)
// ---------------------------------------------------------------------------

const decodePublishResult = (raw: unknown): PublishEventResult => {
  if (!isObject(raw)) {
    throw new Error('Invalid Platform Events response: expected object');
  }
  const id = raw.id;
  const subject = raw.subject;
  if (typeof id !== 'string' || typeof subject !== 'string') {
    throw new Error('Invalid Platform Events response: missing id or subject');
  }
  return { id, subject };
};

// ---------------------------------------------------------------------------
// Auth header resolution
// ---------------------------------------------------------------------------

const resolveAuthHeaders = async (auth: AuthModule): Promise<Record<string, string>> => {
  if (auth.getRequestHeaders) {
    return auth.getRequestHeaders();
  }
  const token = await auth.getAccessToken();
  return { Authorization: `Bearer ${token}` };
};

const resolveWorkspaceId = async (auth: AuthModule): Promise<string> => {
  const workspaceId = await auth.getWorkspaceId();
  if (workspaceId.length > 0) {
    return workspaceId;
  }
  throw new Error('Platform Events: AuthModule must include a workspaceId');
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export type CreatePlatformEventsClientParams = {
  readonly auth: AuthModule;
  readonly url?: string;
};

export const createPlatformEventsClient = (
  params: CreatePlatformEventsClientParams
): PlatformEventsClient => {
  const baseUrl = params.url ?? resolveDiskdGatewayUrl('platform/events');

  const publish = async (eventParams: PublishEventParams): Promise<PublishEventResult> => {
    const authHeaders = await resolveAuthHeaders(params.auth);
    const workspaceId = await resolveWorkspaceId(params.auth);

    const response = await fetch(`${baseUrl}/publish`, {
      method: 'POST',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
        'X-Workspace-Id': workspaceId,
      },
      body: JSON.stringify({
        subject: eventParams.subject,
        data: eventParams.data,
      }),
    });

    if (!response.ok) {
      let errorMessage = `Platform Events: HTTP ${response.status}`;
      try {
        const errorBody = (await response.json()) as unknown;
        if (isObject(errorBody)) {
          const err = errorBody as PublishEventError;
          errorMessage = `Platform Events: ${err.error}`;
        }
      } catch {
        // Response body not JSON -- use status-only message.
      }
      throw new Error(errorMessage);
    }

    const body: unknown = await response.json();
    return decodePublishResult(body);
  };

  return { publish };
};
