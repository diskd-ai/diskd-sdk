export type JsonScalar = boolean | number | string | null;
export type JsonValue = JsonScalar | JsonObject | readonly JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };

export type DriveSessionConfig = {
  readonly operativeId: string | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly promptText: string | null;
  readonly driveSourcesMuted: boolean;
};

export type DriveSessionExchange = {
  readonly id: string;
  readonly kind: string;
  readonly metadata: JsonObject;
  readonly createdAt: string;
};

export type DriveSessionParticipant = {
  readonly exchangeId: string;
  readonly participantKind: string;
  readonly participantId: string;
  readonly joinedAt: string;
  readonly leftAt: string | null;
};

export type DriveSessionMessage = {
  readonly id: string;
  readonly role: string;

  // Participant denormalization
  readonly participantKind: string;
  readonly participantId: string | null;
  readonly participantName: string | null;
  readonly participantSlug: string | null;

  // Content (null for assistant messages with only tool calls)
  readonly content: string | null;
  readonly contentBlocksJson: string | null;

  // Source + observability
  readonly sourceOrigin: string | null;
  readonly turnCorrelationId: string | null;
  readonly turnContextJson: string | null;

  // Tool calls
  readonly functionCall: JsonObject | null;
  readonly toolCalls: readonly JsonObject[] | null;
  readonly toolCallId: string | null;

  // Context + metadata
  readonly context: JsonObject | null;
  readonly metadata: JsonObject | null;
  readonly attachments: readonly string[] | null;

  readonly subtype: string | null;

  // Linking + branching
  readonly parentMessageId: string | null;
  readonly isSidechain: boolean;

  // Metrics
  readonly tokenCount: number | null;

  // Timestamps
  readonly createdAt: string;
  readonly updatedAt: string | null;
  readonly deletedAt: string | null;
};

export type DriveSessionDocument = {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly title: string | null;
  readonly config: DriveSessionConfig;
  readonly exchanges: readonly DriveSessionExchange[];
  readonly participants: readonly DriveSessionParticipant[];
  readonly messages: readonly DriveSessionMessage[];
  readonly createdAt: string;
  readonly updatedAt: string;

  readonly sourceOrigin: string | null;
  readonly forkSourceSessionId: string | null;
  readonly forkSourceMessageId: string | null;
};

export type DriveSessionProjectScopeRef = {
  readonly scopeType: 'project';
  readonly projectId: string;
};

export type DriveSessionScopeRef = DriveSessionProjectScopeRef;

export type DriveSessionSaveParams = {
  readonly projectId: string;
  readonly session: DriveSessionDocument;
  readonly attributes?: readonly string[];
};

export type DriveSessionSaveResult = {
  readonly sessionId: string;
  readonly messageCount: number;
  readonly updatedAt: string;
};

export type DriveSessionGetParams = {
  readonly projectId: string;
  readonly sessionId: string;
};

export type DriveSessionGetResult = {
  readonly session: DriveSessionDocument;
};

export type DriveSessionGetPreviewParams = {
  readonly projectId: string;
  readonly sessionId: string;
  readonly limit?: number;
};

export type DriveSessionGetPreviewResult = {
  readonly session: DriveSessionDocument;
  readonly messages: readonly DriveSessionMessage[];
  readonly messageCount: number;
};

export type DriveSessionGetMessageRangeParams = {
  readonly projectId: string;
  readonly sessionId: string;
  readonly limit: number;
  readonly before?: string;
};

export type DriveSessionGetMessageRangeResult = {
  readonly messages: readonly DriveSessionMessage[];
  readonly hasMore: boolean;
};

export type DriveSessionListParams = {
  readonly projectId: string;
};

export type DriveSessionListItem = {
  readonly sessionId: string;
  readonly title: string | null;
  readonly messageCount: number;
  readonly updatedAt: string;
  readonly provider: string | null;
  readonly model: string | null;
};

export type DriveSessionListResult = {
  readonly items: readonly DriveSessionListItem[];
};

export type DriveSessionAppendMessagesParams = {
  readonly projectId: string;
  readonly sessionId: string;
  readonly messages: readonly DriveSessionMessage[];
};

export type DriveSessionAppendMessagesResult = {
  readonly sessionId: string;
  readonly messageCount: number;
  readonly updatedAt: string;
};

export type DriveSessionDeleteMessagesByIdsParams = {
  readonly projectId: string;
  readonly sessionId: string;
  readonly messageIds: readonly string[];
};

export type DriveSessionDeleteMessagesRollbackParams = {
  readonly projectId: string;
  readonly sessionId: string;
  readonly rollbackAfterMessageId: string;
};

export type DriveSessionDeleteMessagesParams =
  | DriveSessionDeleteMessagesByIdsParams
  | DriveSessionDeleteMessagesRollbackParams;

export type DriveSessionDeleteMessagesResult = {
  readonly sessionId: string;
  readonly messageCount: number;
  readonly updatedAt: string;
};

export type DriveSessionDeleteParams = {
  readonly projectId: string;
  readonly sessionId: string;
};

export type DriveSessionDeleteResult = {
  readonly sessionId: string;
  readonly status: string;
};

export type DriveScopedSessionStartParams = {
  readonly title?: string;
  readonly workspaceId?: string;
};

export type DriveScopedSessionOpenParams = {
  readonly sessionId: string;
  readonly limit?: number;
};

export type DriveScopedSessionSaveParams = {
  readonly session: DriveSessionDocument;
  readonly attributes?: readonly string[];
};

export type DriveScopedSessionDeleteParams = {
  readonly sessionId: string;
};

export type DriveSessionClient = {
  readonly save: (params: DriveSessionSaveParams) => Promise<DriveSessionSaveResult>;
  readonly get: (params: DriveSessionGetParams) => Promise<DriveSessionGetResult>;
  readonly getPreview: (
    params: DriveSessionGetPreviewParams
  ) => Promise<DriveSessionGetPreviewResult>;
  readonly getMessageRange: (
    params: DriveSessionGetMessageRangeParams
  ) => Promise<DriveSessionGetMessageRangeResult>;
  readonly list: (params: DriveSessionListParams) => Promise<DriveSessionListResult>;
  readonly appendMessages: (
    params: DriveSessionAppendMessagesParams
  ) => Promise<DriveSessionAppendMessagesResult>;
  readonly deleteMessages: (
    params: DriveSessionDeleteMessagesParams
  ) => Promise<DriveSessionDeleteMessagesResult>;
  readonly delete: (params: DriveSessionDeleteParams) => Promise<DriveSessionDeleteResult>;
};
