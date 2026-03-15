const isObject = (value) => typeof value === 'object' && value !== null;
const hasOwn = (obj, key) => Object.hasOwn(obj, key);
const readField = (obj, snakeKey, camelKey) => hasOwn(obj, snakeKey) ? obj[snakeKey] : obj[camelKey];
const readRequiredNonEmptyString = (obj, snakeKey, camelKey) => {
    const value = readField(obj, snakeKey, camelKey);
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`Invalid Drive Session payload: '${snakeKey}' must be a non-empty string`);
    }
    return value;
};
const readRequiredString = (obj, snakeKey, camelKey) => {
    const value = readField(obj, snakeKey, camelKey);
    if (typeof value !== 'string') {
        throw new Error(`Invalid Drive Session payload: '${snakeKey}' must be a string`);
    }
    return value;
};
const readNullableString = (obj, snakeKey, camelKey) => {
    const value = readField(obj, snakeKey, camelKey);
    if (value === undefined || value === null)
        return null;
    if (typeof value !== 'string') {
        throw new Error(`Invalid Drive Session payload: '${snakeKey}' must be a string or null`);
    }
    return value;
};
const readNullableNumber = (obj, snakeKey, camelKey) => {
    const value = readField(obj, snakeKey, camelKey);
    if (value === undefined || value === null)
        return null;
    if (typeof value !== 'number') {
        throw new Error(`Invalid Drive Session payload: '${snakeKey}' must be a number or null`);
    }
    return value;
};
const readRequiredBoolean = (obj, snakeKey, camelKey) => {
    const value = readField(obj, snakeKey, camelKey);
    if (typeof value === 'boolean')
        return value;
    // Be liberal in what we accept: some backends may encode booleans as 0/1.
    if (value === 0)
        return false;
    if (value === 1)
        return true;
    throw new Error(`Invalid Drive Session payload: '${snakeKey}' must be a boolean`);
};
const readRequiredArray = (obj, snakeKey, camelKey) => {
    const value = readField(obj, snakeKey, camelKey);
    if (!Array.isArray(value)) {
        throw new Error(`Invalid Drive Session payload: '${snakeKey}' must be an array`);
    }
    return value;
};
const readOptionalArray = (obj, snakeKey, camelKey) => {
    if (hasOwn(obj, snakeKey)) {
        const value = obj[snakeKey];
        if (value === undefined || value === null)
            return undefined;
        if (!Array.isArray(value))
            throw new Error(`Invalid Drive Session payload: '${snakeKey}' must be an array`);
        return value;
    }
    if (hasOwn(obj, camelKey)) {
        const value = obj[camelKey];
        if (value === undefined || value === null)
            return undefined;
        if (!Array.isArray(value))
            throw new Error(`Invalid Drive Session payload: '${camelKey}' must be an array`);
        return value;
    }
    return undefined;
};
const readRequiredJsonObject = (obj, snakeKey, camelKey) => {
    const value = readField(obj, snakeKey, camelKey);
    if (!isObject(value) || Array.isArray(value)) {
        throw new Error(`Invalid Drive Session payload: '${snakeKey}' must be an object`);
    }
    return value;
};
const readNullableJsonObject = (obj, snakeKey, camelKey) => {
    const value = readField(obj, snakeKey, camelKey);
    if (value === undefined || value === null)
        return null;
    if (!isObject(value) || Array.isArray(value)) {
        throw new Error(`Invalid Drive Session payload: '${snakeKey}' must be an object or null`);
    }
    return value;
};
const readNullableJsonObjectArray = (obj, snakeKey, camelKey) => {
    const value = readField(obj, snakeKey, camelKey);
    if (value === undefined || value === null)
        return null;
    if (!Array.isArray(value)) {
        throw new Error(`Invalid Drive Session payload: '${snakeKey}' must be an array or null`);
    }
    return value.map((item) => {
        if (!isObject(item) || Array.isArray(item)) {
            throw new Error(`Invalid Drive Session payload: '${snakeKey}' must be an array of objects`);
        }
        return item;
    });
};
const readNullableStringArray = (obj, snakeKey, camelKey) => {
    const value = readField(obj, snakeKey, camelKey);
    if (value === undefined || value === null)
        return null;
    if (!Array.isArray(value)) {
        throw new Error(`Invalid Drive Session payload: '${snakeKey}' must be an array or null`);
    }
    return value.map((item) => {
        if (typeof item !== 'string')
            throw new Error(`Invalid Drive Session payload: '${snakeKey}' must be an array of strings`);
        return item;
    });
};
const decodeSessionConfig = (raw) => {
    if (!isObject(raw) || Array.isArray(raw)) {
        throw new Error('Invalid Drive session config: expected object');
    }
    return {
        operativeId: readNullableString(raw, 'operative_id', 'operativeId'),
        provider: readNullableString(raw, 'provider', 'provider'),
        model: readNullableString(raw, 'model', 'model'),
        promptText: readNullableString(raw, 'prompt_text', 'promptText'),
        driveSourcesMuted: readRequiredBoolean(raw, 'drive_sources_muted', 'driveSourcesMuted'),
    };
};
const decodeSessionExchange = (raw) => {
    if (!isObject(raw) || Array.isArray(raw)) {
        throw new Error('Invalid Drive session exchange: expected object');
    }
    return {
        id: readRequiredNonEmptyString(raw, 'id', 'id'),
        kind: readRequiredNonEmptyString(raw, 'kind', 'kind'),
        metadata: readRequiredJsonObject(raw, 'metadata', 'metadata'),
        createdAt: readRequiredNonEmptyString(raw, 'created_at', 'createdAt'),
    };
};
const decodeSessionParticipant = (raw) => {
    if (!isObject(raw) || Array.isArray(raw)) {
        throw new Error('Invalid Drive session participant: expected object');
    }
    return {
        exchangeId: readRequiredNonEmptyString(raw, 'exchange_id', 'exchangeId'),
        participantKind: readRequiredNonEmptyString(raw, 'participant_kind', 'participantKind'),
        participantId: readRequiredNonEmptyString(raw, 'participant_id', 'participantId'),
        joinedAt: readRequiredNonEmptyString(raw, 'joined_at', 'joinedAt'),
        leftAt: readNullableString(raw, 'left_at', 'leftAt'),
    };
};
const decodeSessionMessage = (raw) => {
    if (!isObject(raw) || Array.isArray(raw)) {
        throw new Error('Invalid Drive session message: expected object');
    }
    return {
        id: readRequiredNonEmptyString(raw, 'id', 'id'),
        role: readRequiredNonEmptyString(raw, 'role', 'role'),
        participantKind: readRequiredNonEmptyString(raw, 'participant_kind', 'participantKind'),
        participantId: readNullableString(raw, 'participant_id', 'participantId'),
        participantName: readNullableString(raw, 'participant_name', 'participantName'),
        participantSlug: readNullableString(raw, 'participant_slug', 'participantSlug'),
        content: readRequiredString(raw, 'content', 'content'),
        contentBlocksJson: readNullableString(raw, 'content_blocks_json', 'contentBlocksJson'),
        sourceOrigin: readNullableString(raw, 'source_origin', 'sourceOrigin'),
        turnCorrelationId: readNullableString(raw, 'turn_correlation_id', 'turnCorrelationId'),
        turnContextJson: readNullableString(raw, 'turn_context_json', 'turnContextJson'),
        functionCall: readNullableJsonObject(raw, 'function_call', 'functionCall'),
        toolCalls: readNullableJsonObjectArray(raw, 'tool_calls', 'toolCalls'),
        toolCallId: readNullableString(raw, 'tool_call_id', 'toolCallId'),
        context: readNullableJsonObject(raw, 'context', 'context'),
        metadata: readNullableJsonObject(raw, 'metadata', 'metadata'),
        attachments: readNullableStringArray(raw, 'attachments', 'attachments'),
        subtype: readNullableString(raw, 'subtype', 'subtype'),
        parentMessageId: readNullableString(raw, 'parent_message_id', 'parentMessageId'),
        isSidechain: readRequiredBoolean(raw, 'is_sidechain', 'isSidechain'),
        tokenCount: readNullableNumber(raw, 'token_count', 'tokenCount'),
        createdAt: readRequiredNonEmptyString(raw, 'created_at', 'createdAt'),
        updatedAt: readNullableString(raw, 'updated_at', 'updatedAt'),
        deletedAt: readNullableString(raw, 'deleted_at', 'deletedAt'),
    };
};
const decodeSessionDocument = (raw) => {
    if (!isObject(raw) || Array.isArray(raw)) {
        throw new Error('Invalid Drive session document: expected object');
    }
    const exchangesRaw = readOptionalArray(raw, 'exchanges', 'exchanges') ?? [];
    const participantsRaw = readOptionalArray(raw, 'participants', 'participants') ?? [];
    const messagesRaw = readOptionalArray(raw, 'messages', 'messages') ?? [];
    return {
        id: readRequiredNonEmptyString(raw, 'id', 'id'),
        workspaceId: readRequiredNonEmptyString(raw, 'workspace_id', 'workspaceId'),
        projectId: readRequiredNonEmptyString(raw, 'project_id', 'projectId'),
        title: readNullableString(raw, 'title', 'title'),
        config: decodeSessionConfig(readField(raw, 'config', 'config')),
        exchanges: exchangesRaw.map(decodeSessionExchange),
        participants: participantsRaw.map(decodeSessionParticipant),
        messages: messagesRaw.map(decodeSessionMessage),
        createdAt: readRequiredNonEmptyString(raw, 'created_at', 'createdAt'),
        updatedAt: readRequiredNonEmptyString(raw, 'updated_at', 'updatedAt'),
        sourceOrigin: readNullableString(raw, 'source_origin', 'sourceOrigin'),
        forkSourceSessionId: readNullableString(raw, 'fork_source_session_id', 'forkSourceSessionId'),
        forkSourceMessageId: readNullableString(raw, 'fork_source_message_id', 'forkSourceMessageId'),
    };
};
const encodeSessionConfig = (config) => ({
    operative_id: config.operativeId,
    provider: config.provider,
    model: config.model,
    prompt_text: config.promptText,
    drive_sources_muted: config.driveSourcesMuted,
});
const encodeSessionExchange = (exchange) => ({
    id: exchange.id,
    kind: exchange.kind,
    metadata: exchange.metadata,
    created_at: exchange.createdAt,
});
const encodeSessionParticipant = (participant) => ({
    exchange_id: participant.exchangeId,
    participant_kind: participant.participantKind,
    participant_id: participant.participantId,
    joined_at: participant.joinedAt,
    left_at: participant.leftAt,
});
const encodeSessionMessage = (message) => ({
    id: message.id,
    role: message.role,
    participant_kind: message.participantKind,
    participant_id: message.participantId,
    participant_name: message.participantName,
    participant_slug: message.participantSlug,
    content: message.content,
    content_blocks_json: message.contentBlocksJson,
    source_origin: message.sourceOrigin,
    turn_correlation_id: message.turnCorrelationId,
    turn_context_json: message.turnContextJson,
    function_call: message.functionCall,
    tool_calls: message.toolCalls,
    tool_call_id: message.toolCallId,
    context: message.context,
    metadata: message.metadata,
    attachments: message.attachments,
    subtype: message.subtype,
    parent_message_id: message.parentMessageId,
    is_sidechain: message.isSidechain,
    token_count: message.tokenCount,
    created_at: message.createdAt,
    updated_at: message.updatedAt,
    deleted_at: message.deletedAt,
});
const encodeSessionDocument = (doc) => ({
    id: doc.id,
    workspace_id: doc.workspaceId,
    project_id: doc.projectId,
    title: doc.title,
    config: encodeSessionConfig(doc.config),
    exchanges: doc.exchanges.map(encodeSessionExchange),
    participants: doc.participants.map(encodeSessionParticipant),
    messages: doc.messages.map(encodeSessionMessage),
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
    source_origin: doc.sourceOrigin,
    fork_source_session_id: doc.forkSourceSessionId,
    fork_source_message_id: doc.forkSourceMessageId,
});
const decodeSaveResult = (raw) => {
    if (!isObject(raw) || Array.isArray(raw))
        throw new Error('Invalid drive/session/save result');
    return {
        sessionId: readRequiredNonEmptyString(raw, 'session_id', 'sessionId'),
        messageCount: (() => {
            const v = readField(raw, 'message_count', 'messageCount');
            if (typeof v !== 'number')
                throw new Error("Invalid drive/session/save result: 'message_count' must be a number");
            return v;
        })(),
        updatedAt: readRequiredNonEmptyString(raw, 'updated_at', 'updatedAt'),
    };
};
const decodeAppendResult = (raw) => {
    if (!isObject(raw) || Array.isArray(raw))
        throw new Error('Invalid drive/session/append-messages result');
    return {
        sessionId: readRequiredNonEmptyString(raw, 'session_id', 'sessionId'),
        messageCount: (() => {
            const v = readField(raw, 'message_count', 'messageCount');
            if (typeof v !== 'number')
                throw new Error("Invalid drive/session/append-messages result: 'message_count' must be a number");
            return v;
        })(),
        updatedAt: readRequiredNonEmptyString(raw, 'updated_at', 'updatedAt'),
    };
};
const decodeDeleteMessagesResult = (raw) => {
    if (!isObject(raw) || Array.isArray(raw))
        throw new Error('Invalid drive/session/delete-messages result');
    return {
        sessionId: readRequiredNonEmptyString(raw, 'session_id', 'sessionId'),
        messageCount: (() => {
            const v = readField(raw, 'message_count', 'messageCount');
            if (typeof v !== 'number')
                throw new Error("Invalid drive/session/delete-messages result: 'message_count' must be a number");
            return v;
        })(),
        updatedAt: readRequiredNonEmptyString(raw, 'updated_at', 'updatedAt'),
    };
};
const decodeGetResult = (raw) => {
    if (!isObject(raw) || Array.isArray(raw))
        throw new Error('Invalid drive/session/get result');
    const sessionRaw = readField(raw, 'session', 'session');
    return { session: decodeSessionDocument(sessionRaw) };
};
const decodeGetPreviewResult = (raw) => {
    if (!isObject(raw) || Array.isArray(raw))
        throw new Error('Invalid drive/session/get-preview result');
    const sessionRaw = readField(raw, 'session', 'session');
    const messagesRaw = readRequiredArray(raw, 'messages', 'messages');
    const messageCountRaw = readField(raw, 'message_count', 'messageCount');
    if (typeof messageCountRaw !== 'number') {
        throw new Error("Invalid drive/session/get-preview result: 'message_count' must be a number");
    }
    return {
        session: decodeSessionDocument(sessionRaw),
        messages: messagesRaw.map(decodeSessionMessage),
        messageCount: messageCountRaw,
    };
};
const decodeGetMessageRangeResult = (raw) => {
    if (!isObject(raw) || Array.isArray(raw))
        throw new Error('Invalid drive/session/get-message-range result');
    const messagesRaw = readRequiredArray(raw, 'messages', 'messages');
    const hasMoreRaw = readField(raw, 'has_more', 'hasMore');
    if (typeof hasMoreRaw !== 'boolean')
        throw new Error("Invalid drive/session/get-message-range result: 'has_more' must be a boolean");
    return { messages: messagesRaw.map(decodeSessionMessage), hasMore: hasMoreRaw };
};
const decodeListResult = (raw) => {
    if (!isObject(raw) || Array.isArray(raw))
        throw new Error('Invalid drive/session/list result');
    const itemsRaw = readRequiredArray(raw, 'items', 'items');
    return {
        items: itemsRaw.map((itemRaw) => {
            if (!isObject(itemRaw) || Array.isArray(itemRaw))
                throw new Error('Invalid drive/session/list result: item must be object');
            const messageCountRaw = readField(itemRaw, 'message_count', 'messageCount');
            if (typeof messageCountRaw !== 'number')
                throw new Error("Invalid drive/session/list item: 'message_count' must be a number");
            return {
                sessionId: readRequiredNonEmptyString(itemRaw, 'session_id', 'sessionId'),
                title: readNullableString(itemRaw, 'title', 'title'),
                messageCount: messageCountRaw,
                updatedAt: readRequiredNonEmptyString(itemRaw, 'updated_at', 'updatedAt'),
                provider: readNullableString(itemRaw, 'provider', 'provider'),
                model: readNullableString(itemRaw, 'model', 'model'),
            };
        }),
    };
};
const decodeDeleteResult = (raw) => {
    if (!isObject(raw) || Array.isArray(raw))
        throw new Error('Invalid drive/session/delete result');
    return {
        sessionId: readRequiredNonEmptyString(raw, 'session_id', 'sessionId'),
        status: readRequiredNonEmptyString(raw, 'status', 'status'),
    };
};
export const createDriveSessionClient = (params) => {
    return {
        save: async (p) => {
            const result = await params.call('drive/session/save', {
                project_id: p.projectId,
                session: encodeSessionDocument(p.session),
                ...(p.attributes ? { attributes: p.attributes } : {}),
            });
            return decodeSaveResult(result);
        },
        get: async (p) => {
            const result = await params.call('drive/session/get', {
                project_id: p.projectId,
                session_id: p.sessionId,
            });
            return decodeGetResult(result);
        },
        getPreview: async (p) => {
            const result = await params.call('drive/session/get-preview', {
                project_id: p.projectId,
                session_id: p.sessionId,
                ...(p.limit !== undefined ? { limit: p.limit } : {}),
            });
            return decodeGetPreviewResult(result);
        },
        getMessageRange: async (p) => {
            const result = await params.call('drive/session/get-message-range', {
                project_id: p.projectId,
                session_id: p.sessionId,
                limit: p.limit,
                ...(p.before !== undefined ? { before: p.before } : {}),
            });
            return decodeGetMessageRangeResult(result);
        },
        list: async (p) => {
            const result = await params.call('drive/session/list', { project_id: p.projectId });
            return decodeListResult(result);
        },
        appendMessages: async (p) => {
            const result = await params.call('drive/session/append-messages', {
                project_id: p.projectId,
                session_id: p.sessionId,
                messages: p.messages.map(encodeSessionMessage),
            });
            return decodeAppendResult(result);
        },
        deleteMessages: async (p) => {
            const result = await params.call('drive/session/delete-messages', (() => {
                if ('messageIds' in p) {
                    return {
                        project_id: p.projectId,
                        session_id: p.sessionId,
                        message_ids: p.messageIds,
                    };
                }
                return {
                    project_id: p.projectId,
                    session_id: p.sessionId,
                    rollback_after_message_id: p.rollbackAfterMessageId,
                };
            })());
            return decodeDeleteMessagesResult(result);
        },
        delete: async (p) => {
            const result = await params.call('drive/session/delete', {
                project_id: p.projectId,
                session_id: p.sessionId,
            });
            return decodeDeleteResult(result);
        },
    };
};
