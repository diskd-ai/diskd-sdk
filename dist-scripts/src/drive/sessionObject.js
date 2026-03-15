import { buildMessage, buildMinimalDocument, generateUlid } from './sessionBuilder.js';
const assertNotDisposed = (state) => {
    if (state.disposed) {
        throw new Error('DriveSession is disposed');
    }
};
const createDriveSession = (params) => {
    const state = {
        document: params.document,
        messages: params.messages,
        messageCount: params.messageCount,
        disposed: false,
    };
    const { rpc, projectId, sessionId } = params;
    const session = {
        get projectId() {
            return projectId;
        },
        get sessionId() {
            return sessionId;
        },
        get document() {
            return state.document;
        },
        get messages() {
            return state.messages;
        },
        get messageCount() {
            return state.messageCount;
        },
        append: async (messages) => {
            assertNotDisposed(state);
            const result = await rpc.appendMessages({ projectId, sessionId, messages });
            state.messageCount = result.messageCount;
            state.messages = [...state.messages, ...messages];
        },
        rollback: async (afterMessageId) => {
            assertNotDisposed(state);
            const result = await rpc.deleteMessages({
                projectId,
                sessionId,
                rollbackAfterMessageId: afterMessageId,
            });
            state.messageCount = result.messageCount;
            const idx = state.messages.findIndex((m) => m.id === afterMessageId);
            if (idx >= 0) {
                state.messages = state.messages.slice(0, idx);
            }
        },
        remove: async (messageIds) => {
            assertNotDisposed(state);
            const result = await rpc.deleteMessages({ projectId, sessionId, messageIds });
            state.messageCount = result.messageCount;
            const idSet = new Set(messageIds);
            state.messages = state.messages.filter((m) => !idSet.has(m.id));
        },
        fork: async (forkParams) => {
            assertNotDisposed(state);
            const full = await rpc.get({ projectId, sessionId });
            const allMessages = full.session.messages;
            const forkIdx = allMessages.findIndex((m) => m.id === forkParams.atMessageId);
            if (forkIdx < 0) {
                throw new Error(`Fork point message '${forkParams.atMessageId}' not found in session`);
            }
            const forkedMessages = allMessages.slice(0, forkIdx + 1);
            const newSessionId = generateUlid();
            const forkedDoc = {
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
        refresh: async () => {
            assertNotDisposed(state);
            const result = await rpc.get({ projectId, sessionId });
            state.document = { ...result.session, messages: [] };
            state.messages = result.session.messages;
            state.messageCount = result.session.messages.length;
        },
        loadMore: async (loadParams) => {
            assertNotDisposed(state);
            const oldestId = state.messages.length > 0 ? state.messages[0]?.id : undefined;
            const result = await rpc.getMessageRange({
                projectId,
                sessionId,
                limit: loadParams.limit,
                ...(oldestId !== undefined ? { before: oldestId } : {}),
            });
            state.messages = [...result.messages, ...state.messages];
            return result;
        },
        dispose: () => {
            state.disposed = true;
        },
    };
    return session;
};
export const createDriveSessionManager = (params) => {
    const { rpc } = params;
    return {
        start: async (startParams) => {
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
        open: async (openParams) => {
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
        save: async (saveParams) => {
            return rpc.save(saveParams);
        },
        list: async (listParams) => {
            return rpc.list(listParams);
        },
        delete: async (deleteParams) => {
            return rpc.delete(deleteParams);
        },
        message: (msgParams) => {
            return buildMessage(msgParams);
        },
    };
};
export const createScopedDriveSessionManager = (params) => {
    const { manager, projectId } = params;
    return {
        start: async (startParams) => {
            return manager.start({ ...startParams, projectId });
        },
        open: async (openParams) => {
            return manager.open({ ...openParams, projectId });
        },
        save: async (saveParams) => {
            return manager.save({ ...saveParams, projectId });
        },
        list: async () => {
            return manager.list({ projectId });
        },
        delete: async (deleteParams) => {
            return manager.delete({ ...deleteParams, projectId });
        },
        message: (msgParams) => {
            return manager.message(msgParams);
        },
    };
};
