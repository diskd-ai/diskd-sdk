/**
 * Types for the Platform Events client.
 *
 * Events are published to the app-service events endpoint at POST /publish
 * and forwarded to the NATS JetStream stream PLATFORM_EVENTS.
 */

/** Parameters for publishing a domain event via the app-service events endpoint. */
export type PublishEventParams = {
  /** Event type (e.g., "email.received"). Must be in the bridge allowlist. */
  readonly subject: string;
  /** Arbitrary event payload (JSON-serializable). */
  readonly data: Readonly<Record<string, unknown>>;
};

/** Result returned after a successful publish (HTTP 202). */
export type PublishEventResult = {
  /** ULID assigned to the event by the bridge. */
  readonly id: string;
  /** Full NATS subject (e.g., "platform.ws_01ABC.email.received"). */
  readonly subject: string;
};

/** Error shape returned by the NATS Bridge on failure (4xx/5xx). */
export type PublishEventError = {
  readonly error: string;
  readonly allowed?: readonly string[];
};

/** Platform Events client interface. */
export type PlatformEventsClient = {
  /** Publish a domain event to the NATS event bus. */
  readonly publish: (params: PublishEventParams) => Promise<PublishEventResult>;
};
