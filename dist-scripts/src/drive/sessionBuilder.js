const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const encodeTime = (ms, length) => {
    let value = ms;
    const chars = [];
    for (let i = 0; i < length; i += 1) {
        chars.unshift(CROCKFORD[value % 32]);
        value = Math.floor(value / 32);
    }
    return chars.join('');
};
const encodeRandom = (length) => {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => CROCKFORD[b % 32]).join('');
};
export const generateUlid = () => encodeTime(Date.now(), 10) + encodeRandom(16);
const inferParticipantKind = (role) => {
    if (role === 'user')
        return 'human';
    if (role === 'assistant')
        return 'ai';
    if (role === 'system')
        return 'system';
    return role;
};
export const buildMessage = (params) => ({
    id: params.id ?? generateUlid(),
    role: params.role,
    participantKind: params.participantKind ?? inferParticipantKind(params.role),
    participantId: params.participantId ?? null,
    participantName: params.participantName ?? null,
    participantSlug: params.participantSlug ?? null,
    content: params.content,
    contentBlocksJson: params.contentBlocksJson ?? null,
    sourceOrigin: params.sourceOrigin ?? null,
    turnCorrelationId: params.turnCorrelationId ?? null,
    turnContextJson: params.turnContextJson ?? null,
    functionCall: params.functionCall ?? null,
    toolCalls: params.toolCalls ?? null,
    toolCallId: params.toolCallId ?? null,
    context: params.context ?? null,
    metadata: params.metadata ?? null,
    attachments: params.attachments ?? null,
    subtype: params.subtype ?? null,
    parentMessageId: params.parentMessageId ?? null,
    isSidechain: params.isSidechain ?? false,
    tokenCount: params.tokenCount ?? null,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    deletedAt: null,
});
const emptyConfig = {
    operativeId: null,
    provider: null,
    model: null,
    promptText: null,
    driveSourcesMuted: false,
};
export const buildMinimalDocument = (params) => {
    const now = new Date().toISOString();
    return {
        id: params.sessionId,
        workspaceId: params.workspaceId ?? '',
        projectId: params.projectId,
        title: params.title ?? null,
        config: emptyConfig,
        exchanges: [],
        participants: [],
        messages: [],
        createdAt: now,
        updatedAt: now,
        sourceOrigin: null,
        forkSourceSessionId: null,
        forkSourceMessageId: null,
    };
};
