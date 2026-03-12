import type {
  DriveSessionClient,
  DriveSessionDeleteResult,
  DriveSessionDocument,
  DriveSessionGetMessageRangeResult,
  DriveSessionListResult,
  DriveSessionMessage,
  DriveSessionSaveParams,
  DriveSessionSaveResult,
} from './sessionTypes.js';
import type { MessageParams } from './sessionBuilder.js';
import { buildMessage, buildMinimalDocument, generateUlid } from './sessionBuilder.js';

export type DriveSession = {
  readonly projectId: string;
  readonly sessionId: string;
  readonly document: DriveSessionDocument;
  readonly messages: readonly DriveSessionMessage[];
  readonly messageCount: number;

  readonly append: (messages: readonly DriveSessionMessage[]) => Promise<void>;
  readonly rollback: (afterMessageId: string) => Promise<void>;
  readonly remove: (messageIds: readonly string[]) => Promise<void>;
  readonly fork: (params: { readonly atMessageId: string }) => Promise<DriveSession>;

  readonly refresh: () => Promise<void>;
  readonly loadMore: (params: { readonly limit: number }) => Promise<DriveSessionGetMessageRangeResult>;

  readonly dispose: () => void;
};

export type DriveSessionManager = {
  readonly start: (params: { readonly projectId: string; readonly title?: string; readonly workspaceId?: string }) => Promise<DriveSession>;
  readonly open: (params: { readonly projectId: string; readonly sessionId: string; readonly limit?: number }) => Promise<DriveSession>;
  readonly save: (params: DriveSessionSaveParams) => Promise<DriveSessionSaveResult>;
  readonly list: (params: { readonly projectId: string }) => Promise<DriveSessionListResult>;
  readonly delete: (params: { readonly projectId: string; readonly sessionId: string }) => Promise<DriveSessionDeleteResult>;
  readonly message: (params: MessageParams) => DriveSessionMessage;
};

type SessionState = {
  document: DriveSessionDocument;
  messages: readonly DriveSessionMessage[];
  messageCount: number;
  disposed: boolean;
};

const assertNotDisposed = (state: SessionState): void => {
  if (state.disposed) {
    throw new Error('DriveSession is disposed');
  }
};

const createDriveSession = (params: {
  readonly rpc: DriveSessionClient;
  readonly projectId: string;
  readonly sessionId: string;
  readonly document: DriveSessionDocument;
  readonly messages: readonly DriveSessionMessage[];
  readonly messageCount: number;
}): DriveSession => {
  const state: SessionState = {
    document: params.document,
    messages: params.messages,
    messageCount: params.messageCount,
    disposed: false,
  };

  const { rpc, projectId, sessionId } = params;

  const session: DriveSession = {
    get projectId() { return projectId; },
    get sessionId() { return sessionId; },
    get document() { return state.document; },
    get messages() { return state.messages; },
    get messageCount() { return state.messageCount; },

    append: async (messages: readonly DriveSessionMessage[]): Promise<void> => {
      assertNotDisposed(state);
      const result = await rpc.appendMessages({ projectId, sessionId, messages });
      state.messageCount = result.messageCount;
      state.messages = [...state.messages, ...messages];
    },

    rollback: async (afterMessageId: string): Promise<void> => {
      assertNotDisposed(state);
      const result = await rpc.deleteMessages({ projectId, sessionId, rollbackAfterMessageId: afterMessageId });
      state.messageCount = result.messageCount;
      const idx = state.messages.findIndex((m) => m.id === afterMessageId);
      if (idx >= 0) {
        state.messages = state.messages.slice(0, idx);
      }
    },

    remove: async (messageIds: readonly string[]): Promise<void> => {
      assertNotDisposed(state);
      const result = await rpc.deleteMessages({ projectId, sessionId, messageIds });
      state.messageCount = result.messageCount;
      const idSet = new Set(messageIds);
      state.messages = state.messages.filter((m) => !idSet.has(m.id));
    },

    fork: async (forkParams: { readonly atMessageId: string }): Promise<DriveSession> => {
      assertNotDisposed(state);
      const full = await rpc.get({ projectId, sessionId });
      const allMessages = full.session.messages;
      const forkIdx = allMessages.findIndex((m) => m.id === forkParams.atMessageId);
      if (forkIdx < 0) {
        throw new Error(`Fork point message '${forkParams.atMessageId}' not found in session`);
      }
      const forkedMessages = allMessages.slice(0, forkIdx + 1);
      const newSessionId = generateUlid();
      const forkedDoc: DriveSessionDocument = {
        ...full.session,
        id: newSessionId,
        messages: forkedMessages,
        forkSourceSessionId: sessionId,
        forkSourceMessageId: forkParams.atMessageId,
        updatedAt: new Date().toISOString(),
      };
      const saveResult = await rpc.save({ projectId, session: forkedDoc });
      return createDriveSession({
        rpc,
        projectId,
        sessionId: newSessionId,
        document: { ...forkedDoc, messages: [] },
        messages: forkedMessages,
        messageCount: saveResult.messageCount,
      });
    },

    refresh: async (): Promise<void> => {
      assertNotDisposed(state);
      const result = await rpc.get({ projectId, sessionId });
      state.document = { ...result.session, messages: [] };
      state.messages = result.session.messages;
      state.messageCount = result.session.messages.length;
    },

    loadMore: async (loadParams: { readonly limit: number }): Promise<DriveSessionGetMessageRangeResult> => {
      assertNotDisposed(state);
      const oldestId = state.messages.length > 0 ? state.messages[0]!.id : undefined;
      const result = await rpc.getMessageRange({
        projectId,
        sessionId,
        limit: loadParams.limit,
        ...(oldestId !== undefined ? { before: oldestId } : {}),
      });
      state.messages = [...result.messages, ...state.messages];
      return result;
    },

    dispose: (): void => {
      state.disposed = true;
    },
  };

  return session;
};

export const createDriveSessionManager = (params: {
  readonly rpc: DriveSessionClient;
}): DriveSessionManager => {
  const { rpc } = params;

  return {
    start: async (startParams): Promise<DriveSession> => {
      const sessionId = generateUlid();
      const doc = buildMinimalDocument({
        sessionId,
        projectId: startParams.projectId,
        title: startParams.title,
        workspaceId: startParams.workspaceId,
      });
      const saveResult = await rpc.save({ projectId: startParams.projectId, session: doc });
      return createDriveSession({
        rpc,
        projectId: startParams.projectId,
        sessionId,
        document: doc,
        messages: [],
        messageCount: saveResult.messageCount,
      });
    },

    open: async (openParams): Promise<DriveSession> => {
      const { projectId, sessionId, limit } = openParams;
      if (limit !== undefined) {
        const result = await rpc.getPreview({ projectId, sessionId, limit });
        return createDriveSession({
          rpc,
          projectId,
          sessionId,
          document: result.session,
          messages: result.messages,
          messageCount: result.messageCount,
        });
      }
      const result = await rpc.get({ projectId, sessionId });
      return createDriveSession({
        rpc,
        projectId,
        sessionId,
        document: { ...result.session, messages: [] },
        messages: result.session.messages,
        messageCount: result.session.messages.length,
      });
    },

    save: async (saveParams): Promise<DriveSessionSaveResult> => {
      return rpc.save(saveParams);
    },

    list: async (listParams): Promise<DriveSessionListResult> => {
      return rpc.list(listParams);
    },

    delete: async (deleteParams): Promise<DriveSessionDeleteResult> => {
      return rpc.delete(deleteParams);
    },

    message: (msgParams: MessageParams): DriveSessionMessage => {
      return buildMessage(msgParams);
    },
  };
};
