import type { AuthModule } from '../auth/types.js';
import { createDriveClient } from '../drive/drive.js';
import type { DriveClient, DrivePathEntry } from '../drive/types.js';
import { createMcpToolsClient } from '../mcpTools/mcpTools.js';
import type { McpToolsClient } from '../mcpTools/mcpToolsTypes.js';
import { createMessagesStoreClient } from '../messagesStore/messagesStore.js';
import type { MessagesStoreClient, StoredMessage } from '../messagesStore/messagesStoreTypes.js';
import type {
  InboxAccountList,
  InboxClient,
  InboxEmailEnvelope,
  InboxListParams,
  InboxMarkReadParams,
  InboxPage,
  InboxReadParams,
  InboxSaveAttachmentParams,
  InboxSaveAttachmentResult,
  InboxSearchParams,
  StoredEmail,
  StoredEmailAttachment,
  StoredEmailContact,
} from './inboxTypes.js';

const MAIL_ROOT = '/.profile/mail';
const DEFAULT_EXCHANGE_FOLDER = 'INBOX';
const SEARCH_SCAN_LIMIT = 100;
const SYSTEM_HYDRATE_EMAIL_BODIES_TOOL = 'system_hydrate_email_bodies';
const SYSTEM_HYDRATE_EMAIL_ATTACHMENT_TOOL = 'system_hydrate_email_attachment';
const REF_PREFIX = 'op-inbox:';

type MessageRef =
  | { readonly source: 'legacy'; readonly account: string; readonly messageId: string }
  | {
      readonly source: 'exchange';
      readonly account: string;
      readonly folderId: string;
      readonly messageId: string;
    };

type RawObject = { readonly [key: string]: unknown };

const isObject = (value: unknown): value is RawObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === 'string';
const isBool = (value: unknown): value is boolean => typeof value === 'boolean';
const isNumber = (value: unknown): value is number => typeof value === 'number';

const nonEmpty = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
};

const exchangeMailboxId = (account: string): string => {
  const lower = account.toLowerCase();
  const slug = lower.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (slug.length === 0) return 'exchange-default';
  if (slug.startsWith('exchange-')) return slug.slice(0, 64);
  return `exchange-${slug.slice(0, 55)}`;
};

const inboxPath = (account: string): string => `${MAIL_ROOT}/${account}/inbox`;

const isJsonFile = (entry: DrivePathEntry): boolean =>
  entry.type === 'file' && entry.name.endsWith('.json');

const isDirectory = (entry: DrivePathEntry): boolean => entry.type === 'dir';

const encodeRef = (ref: MessageRef): string =>
  `${REF_PREFIX}${Buffer.from(JSON.stringify(ref), 'utf-8').toString('base64url')}`;

const decodeRef = (value: string): MessageRef | null => {
  if (!value.startsWith(REF_PREFIX)) return null;
  try {
    const decoded = JSON.parse(
      Buffer.from(value.slice(REF_PREFIX.length), 'base64url').toString('utf-8')
    ) as unknown;
    if (!isObject(decoded)) return null;
    const source = decoded.source;
    const account = decoded.account;
    const messageId = decoded.messageId;
    if (!isString(account) || !isString(messageId)) return null;
    if (source === 'legacy') return { source, account, messageId };
    if (source === 'exchange' && isString(decoded.folderId)) {
      return { source, account, folderId: decoded.folderId, messageId };
    }
    return null;
  } catch {
    return null;
  }
};

const parseContact = (value: unknown): StoredEmailContact => {
  if (!isObject(value)) return { name: '', address: '' };
  return {
    name: isString(value.name) ? value.name : '',
    address: isString(value.address) ? value.address : '',
  };
};

const parseContactList = (value: unknown): readonly StoredEmailContact[] =>
  Array.isArray(value) ? value.map(parseContact) : [];

const stringArray = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter(isString) : [];

const hasFlag = (payload: RawObject, flag: string): boolean =>
  Array.isArray(payload.flags) &&
  payload.flags.some((item) => isString(item) && item.toLowerCase() === flag.toLowerCase());

const parseAttachment = (value: unknown): StoredEmailAttachment => {
  if (!isObject(value)) {
    return { filename: '', contentType: '', size: 0, drivePath: '' };
  }
  return {
    filename: isString(value.filename) ? value.filename : '',
    contentType: isString(value.contentType) ? value.contentType : '',
    size: isNumber(value.size)
      ? value.size
      : isNumber(value.sizeBytes)
        ? value.sizeBytes
        : isNumber(value.storedSizeBytes)
          ? value.storedSizeBytes
          : 0,
    drivePath: isString(value.drivePath) ? value.drivePath : '',
    ...(isString(value.attachmentId) ? { attachmentId: value.attachmentId } : {}),
    ...(isString(value.storageState) ? { storageState: value.storageState } : {}),
    ...(isNumber(value.storedSizeBytes) ? { storedSizeBytes: value.storedSizeBytes } : {}),
    ...(isString(value.storedAt) ? { storedAt: value.storedAt } : {}),
    ...(isString(value.lastLoadError) ? { lastLoadError: value.lastLoadError } : {}),
  };
};

const parseStoredEmail = (value: unknown): StoredEmail | null => {
  if (!isObject(value) || !isString(value.messageId)) return null;
  return {
    messageId: value.messageId,
    uid: isNumber(value.uid) ? value.uid : null,
    account: isString(value.account) ? value.account : '',
    folder: isString(value.folder) ? value.folder : 'inbox',
    from: parseContact(value.from),
    to: parseContactList(value.to),
    cc: parseContactList(value.cc),
    subject: isString(value.subject) ? value.subject : '',
    date: isString(value.date) ? value.date : '',
    receivedAt: isString(value.receivedAt) ? value.receivedAt : '',
    snippet: isString(value.snippet) ? value.snippet : '',
    bodyText: isString(value.bodyText) ? value.bodyText : '',
    bodyHtml: isString(value.bodyHtml) ? value.bodyHtml : '',
    hasAttachments: isBool(value.hasAttachments) ? value.hasAttachments : false,
    attachments: Array.isArray(value.attachments) ? value.attachments.map(parseAttachment) : [],
    labels: stringArray(value.labels),
    isRead: isBool(value.isRead) ? value.isRead : false,
    isFlagged: isBool(value.isFlagged) ? value.isFlagged : false,
    priority: isString(value.priority) ? value.priority : 'normal',
    webhookEvent: isString(value.webhookEvent) ? value.webhookEvent : '',
    rule: isString(value.rule) ? value.rule : null,
  };
};

const legacyEnvelope = (
  email: StoredEmail,
  account: string,
  drivePath: string
): InboxEmailEnvelope => ({
  messageRef: encodeRef({ source: 'legacy', account, messageId: email.messageId }),
  folderId: email.folder || 'inbox',
  account: email.account || account,
  messageId: email.messageId,
  from: email.from,
  subject: email.subject,
  snippet: email.snippet,
  date: email.date,
  hasAttachments: email.hasAttachments,
  isRead: email.isRead,
  isFlagged: email.isFlagged,
  priority: email.priority,
  labels: email.labels,
  drivePath,
});

const withLegacyRef = (email: StoredEmail, account: string): StoredEmail => ({
  ...email,
  messageRef: encodeRef({ source: 'legacy', account, messageId: email.messageId }),
  folderId: email.folder || 'inbox',
});

const payloadObject = (row: StoredMessage): RawObject => (isObject(row.payload) ? row.payload : {});

const exchangeStoredEmail = (
  row: StoredMessage,
  account: string,
  folderId: string
): StoredEmail => {
  const payload = payloadObject(row);
  const messageId = row.externalId;
  const folder = isString(payload.mailbox)
    ? payload.mailbox
    : isString(payload.folderId)
      ? payload.folderId
      : folderId;
  return {
    messageRef: encodeRef({ source: 'exchange', account, folderId: folder, messageId }),
    folderId: folder,
    messageId,
    uid: isNumber(payload.uid) ? payload.uid : null,
    account: isString(payload.accountId)
      ? payload.accountId
      : isString(payload.account)
        ? payload.account
        : account,
    folder,
    from: parseContact(payload.from),
    to: parseContactList(payload.to),
    cc: parseContactList(payload.cc),
    subject: isString(payload.subject) ? payload.subject : '',
    date: isString(payload.date) ? payload.date : '',
    receivedAt: isString(payload.receivedAt)
      ? payload.receivedAt
      : isString(payload.fetchedAt)
        ? payload.fetchedAt
        : '',
    snippet: isString(payload.snippet) ? payload.snippet : '',
    bodyText: isString(payload.bodyText) ? payload.bodyText : '',
    bodyHtml: isString(payload.bodyHtml) ? payload.bodyHtml : '',
    hasAttachments: isBool(payload.hasAttachments) ? payload.hasAttachments : false,
    attachments: Array.isArray(payload.attachments) ? payload.attachments.map(parseAttachment) : [],
    labels: stringArray(payload.labels),
    isRead: isBool(payload.isRead) ? payload.isRead : hasFlag(payload, '\\Seen'),
    isFlagged: isBool(payload.isFlagged) ? payload.isFlagged : hasFlag(payload, '\\Flagged'),
    priority: isString(payload.priority) ? payload.priority : 'normal',
    webhookEvent: 'exchange.messagesStore',
    rule: null,
  };
};

const exchangeEnvelope = (
  row: StoredMessage,
  account: string,
  folderId: string
): InboxEmailEnvelope => {
  const email = exchangeStoredEmail(row, account, folderId);
  return {
    messageRef: email.messageRef,
    folderId: email.folderId,
    account: email.account,
    messageId: email.messageId,
    from: email.from,
    subject: email.subject,
    snippet: email.snippet,
    date: email.date,
    hasAttachments: email.hasAttachments,
    isRead: email.isRead,
    isFlagged: email.isFlagged,
    priority: email.priority,
    labels: email.labels,
    drivePath: '',
  };
};

const shouldHydrateBody = (row: StoredMessage): boolean => {
  const payload = payloadObject(row);
  if (payload.bodyState === 'loaded') return false;
  if (
    payload.bodyState === undefined &&
    (isString(payload.bodyText) || isString(payload.bodyHtml))
  ) {
    return false;
  }
  return (
    payload.bodyState === undefined ||
    payload.bodyState === null ||
    payload.bodyState === 'not_loaded' ||
    payload.bodyState === 'failed_retryable'
  );
};

const readStreamToBuffer = async (stream: ReadableStream<Uint8Array>): Promise<Buffer> => {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
};

const isNotFound = (error: unknown): boolean =>
  error instanceof Error &&
  /not.?found|MAILBOX_NOT_FOUND|FOLDER_NOT_FOUND|MESSAGE_NOT_FOUND/i.test(error.message);

const findSystemToolName = async (
  mcpTools: McpToolsClient,
  systemToolName: string
): Promise<string> => {
  const tools = await mcpTools.list();
  const tool = tools.find((item) => item.name.endsWith(`__${systemToolName}`));
  if (!tool) {
    throw new Error(`${systemToolName} tool is not available`);
  }
  return tool.name;
};

const splitPath = (fullPath: string): { readonly parentPath: string; readonly name: string } => {
  const normalized = fullPath.replace(/\/+$/, '');
  if (normalized.length === 0 || normalized === '/') {
    throw new Error('targetPath must include a filename');
  }
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash <= 0) {
    return { parentPath: '/', name: normalized.replace(/^\//, '') };
  }
  return {
    parentPath: normalized.slice(0, lastSlash),
    name: normalized.slice(lastSlash + 1),
  };
};

const findLegacyAttachment = (email: StoredEmail, filename: string): StoredEmailAttachment => {
  const match = email.attachments.find((attachment) => attachment.filename === filename);
  if (!match) throw new Error(`Attachment not found: ${filename}`);
  if (!match.drivePath) throw new Error(`Attachment has no drivePath: ${filename}`);
  return match;
};

const findAttachmentByHandle = (
  email: StoredEmail,
  attachmentId?: string,
  filename?: string
): StoredEmailAttachment => {
  const resolvedAttachmentId = nonEmpty(attachmentId);
  if (resolvedAttachmentId) {
    const match = email.attachments.find(
      (attachment) => attachment.attachmentId === resolvedAttachmentId
    );
    if (!match) throw new Error(`Attachment not found: ${resolvedAttachmentId}`);
    return match;
  }
  const resolvedFilename = nonEmpty(filename);
  if (!resolvedFilename) throw new Error('attachmentId or filename is required');
  const matches = email.attachments.filter(
    (attachment) => attachment.filename === resolvedFilename
  );
  if (matches.length === 0) throw new Error(`Attachment not found: ${resolvedFilename}`);
  if (matches.length > 1) {
    throw new Error(`Multiple attachments named ${resolvedFilename}; use attachmentId`);
  }
  return matches[0] as StoredEmailAttachment;
};

const shouldHydrateAttachment = (attachment: StoredEmailAttachment): boolean =>
  attachment.storageState === 'not_loaded' || attachment.storageState === 'failed_retryable';

export const createInboxClient = (params: {
  readonly auth: AuthModule;
  readonly driveUrl?: string;
  readonly mcpUrl?: string;
}): InboxClient => {
  const drive: DriveClient = createDriveClient({
    version: 'v1',
    auth: params.auth,
    url: params.driveUrl,
  });
  const messagesStore: MessagesStoreClient = createMessagesStoreClient({
    auth: params.auth,
    url: params.driveUrl,
  });
  const mcpTools = createMcpToolsClient({ auth: params.auth, url: params.mcpUrl });
  let hydrateBodyToolName: string | null = null;
  let hydrateAttachmentToolName: string | null = null;

  const listLegacyAccounts = async (): Promise<readonly string[]> => {
    try {
      const entries = await drive.list({ path: MAIL_ROOT });
      return entries.filter(isDirectory).map((entry) => entry.name);
    } catch {
      return [];
    }
  };

  const readLegacyFile = async (path: string): Promise<StoredEmail | null> => {
    const result = await drive.download.file({ path });
    const buffer = await readStreamToBuffer(result.stream);
    return parseStoredEmail(JSON.parse(buffer.toString('utf-8')) as unknown);
  };

  const listLegacy = async (
    account: string,
    limit: number,
    cursor?: string
  ): Promise<InboxPage> => {
    const dirPath = inboxPath(account);
    const entries = await drive.list({ path: dirPath });
    const jsonFiles = entries
      .filter(isJsonFile)
      .slice()
      .sort((a, b) => b.name.localeCompare(a.name));
    const total = jsonFiles.length;
    const startIndex = cursor
      ? Math.max(jsonFiles.findIndex((entry) => entry.id === cursor) + 1, 0)
      : 0;
    const page = jsonFiles.slice(startIndex, startIndex + limit);
    const items: InboxEmailEnvelope[] = [];
    for (const entry of page) {
      const path = `${dirPath}/${entry.name}`;
      const email = await readLegacyFile(path);
      if (email) items.push(legacyEnvelope(email, account, path));
    }
    const last = page[page.length - 1];
    return {
      items,
      nextCursor: startIndex + limit < total && last ? last.id : null,
      total,
    };
  };

  const readLegacy = async (account: string, messageId: string): Promise<StoredEmail> => {
    const dirPath = inboxPath(account);
    const entries = await drive.list({ path: dirPath });
    for (const entry of entries.filter(isJsonFile)) {
      const email = await readLegacyFile(`${dirPath}/${entry.name}`);
      if (email?.messageId === messageId) return withLegacyRef(email, account);
    }
    throw new Error(`Email not found: ${messageId}`);
  };

  const listExchangeFolderIds = async (account: string): Promise<readonly string[]> => {
    try {
      const folders = await messagesStore
        .mailbox({ mailboxId: exchangeMailboxId(account) })
        .listFolders();
      const ids = folders.map((folder) => folder.folderId);
      if (ids.length === 0) return [DEFAULT_EXCHANGE_FOLDER];
      const rest = ids.filter((id) => id !== DEFAULT_EXCHANGE_FOLDER);
      return ids.includes(DEFAULT_EXCHANGE_FOLDER) ? [DEFAULT_EXCHANGE_FOLDER, ...rest] : ids;
    } catch {
      return [DEFAULT_EXCHANGE_FOLDER];
    }
  };

  const hydrateBody = async (
    mailboxId: string,
    folderId: string,
    externalId: string
  ): Promise<void> => {
    hydrateBodyToolName ??= await findSystemToolName(mcpTools, SYSTEM_HYDRATE_EMAIL_BODIES_TOOL);
    const result = await mcpTools.call(hydrateBodyToolName, {
      messages: [{ mailboxId, folderId, externalId }],
      maxMessages: 1,
    });
    if (result.isError) {
      throw new Error(`${SYSTEM_HYDRATE_EMAIL_BODIES_TOOL} returned error`);
    }
  };

  const readExchangeExact = async (
    account: string,
    folderId: string,
    messageId: string
  ): Promise<StoredEmail> => {
    const mailboxId = exchangeMailboxId(account);
    const folder = messagesStore.mailbox({ mailboxId }).folder({ folderId });
    let row = await folder.getMessage({ externalId: messageId });
    if (shouldHydrateBody(row)) {
      await hydrateBody(mailboxId, folderId, row.externalId);
      row = await folder.getMessage({ externalId: row.externalId });
    }
    return exchangeStoredEmail(row, account, folderId);
  };

  const readExchange = async (
    account: string,
    messageId: string,
    folderId?: string
  ): Promise<StoredEmail> => {
    if (folderId) return readExchangeExact(account, folderId, messageId);
    const folders = await listExchangeFolderIds(account);
    let lastError: unknown = null;
    for (const candidate of folders) {
      try {
        return await readExchangeExact(account, candidate, messageId);
      } catch (error) {
        lastError = error;
        if (!isNotFound(error)) throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`Email not found: ${messageId}`);
  };

  const markLegacyRead = async (
    account: string,
    messageId: string,
    isRead: boolean
  ): Promise<StoredEmail> => {
    const dirPath = inboxPath(account);
    const entries = await drive.list({ path: dirPath });
    for (const entry of entries.filter(isJsonFile)) {
      const path = `${dirPath}/${entry.name}`;
      const email = await readLegacyFile(path);
      if (email?.messageId !== messageId) continue;
      const updated = { ...email, isRead };
      await drive.tools.writeFile({ path, content: JSON.stringify(updated, null, 2) });
      return withLegacyRef(updated, account);
    }
    throw new Error(`Email not found: ${messageId}`);
  };

  const markExchangeRead = async (
    account: string,
    folderId: string,
    messageId: string,
    isRead: boolean
  ): Promise<StoredEmail> => {
    const mailboxId = exchangeMailboxId(account);
    const folder = messagesStore.mailbox({ mailboxId }).folder({ folderId });
    const row = await folder.getMessage({ externalId: messageId });
    await folder.upsertBatch({
      items: [{ externalId: row.externalId, payload: { ...row.payload, isRead } }],
    });
    return exchangeStoredEmail({ ...row, payload: { ...row.payload, isRead } }, account, folderId);
  };

  const readLegacyForSave = async (account: string, messageId: string): Promise<StoredEmail> => {
    const directPath = `${inboxPath(account)}/${messageId}`;
    try {
      const email = await readLegacyFile(directPath);
      if (email) return withLegacyRef(email, account);
    } catch {
      // Fall back to scanning by stored messageId for compatibility with read/list handles.
    }
    return readLegacy(account, messageId);
  };

  const saveLegacyAttachment = async (
    account: string,
    messageId: string,
    filename: string,
    targetPath: string
  ): Promise<InboxSaveAttachmentResult> => {
    const email = await readLegacyForSave(account, messageId);
    const attachment = findLegacyAttachment(email, filename);
    const sourceEntries = await drive.resolve({ paths: [attachment.drivePath] });
    const sourceEntry = sourceEntries[0];
    if (!sourceEntry?.fileId) {
      throw new Error(`Cannot resolve fileId for attachment path: ${attachment.drivePath}`);
    }
    const target = splitPath(targetPath);
    const created = await drive.create({
      name: target.name,
      type: 'file',
      parentPath: target.parentPath,
      fileId: sourceEntry.fileId,
    });
    return {
      saved: true,
      entry: {
        id: created.id,
        name: created.name,
        path: targetPath,
        fileId: created.fileId,
      },
    };
  };

  const hydrateAttachment = async (
    mailboxId: string,
    folderId: string,
    externalId: string,
    attachmentId: string
  ): Promise<void> => {
    hydrateAttachmentToolName ??= await findSystemToolName(
      mcpTools,
      SYSTEM_HYDRATE_EMAIL_ATTACHMENT_TOOL
    );
    const result = await mcpTools.call(hydrateAttachmentToolName, {
      mailboxId,
      folderId,
      externalId,
      attachmentId,
    });
    if (result.isError) {
      throw new Error(`${SYSTEM_HYDRATE_EMAIL_ATTACHMENT_TOOL} returned error`);
    }
  };

  const ensureExchangeAttachmentLoaded = async (
    mailboxId: string,
    folderId: string,
    externalId: string,
    attachment: StoredEmailAttachment
  ): Promise<string> => {
    const attachmentId = nonEmpty(attachment.attachmentId);
    if (!attachmentId) throw new Error(`Attachment has no attachmentId: ${attachment.filename}`);
    const scopedMessage = messagesStore
      .mailbox({ mailboxId })
      .folder({ folderId })
      .message({ externalId });
    const hasStoredRow = async (): Promise<boolean> => {
      const rows = await scopedMessage.attachments.list();
      return rows.some((row) => row.attachmentId === attachmentId);
    };
    if (shouldHydrateAttachment(attachment) || !(await hasStoredRow())) {
      await hydrateAttachment(mailboxId, folderId, externalId, attachmentId);
      if (!(await hasStoredRow())) {
        throw new Error(`Attachment not hydrated: ${attachmentId}`);
      }
    }
    return attachmentId;
  };

  const findExchangeMessageByUid = async (
    mailboxId: string,
    folderId: string,
    messageId: string
  ): Promise<StoredMessage> => {
    let cursor: string | undefined;
    do {
      const page = await messagesStore
        .mailbox({ mailboxId })
        .folder({ folderId })
        .listMessages({ limit: SEARCH_SCAN_LIMIT, ...(cursor ? { cursor } : {}) });
      const match = page.items.find((row) => {
        const payload = payloadObject(row);
        return (
          row.externalId === messageId ||
          row.externalId.endsWith(`:${messageId}`) ||
          (isNumber(payload.uid) && String(payload.uid) === messageId)
        );
      });
      if (match) return match;
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    throw new Error(`Email not found: ${messageId}`);
  };

  const resolveExchangeMessageForSave = async (
    account: string,
    messageId: string,
    folderId?: string
  ): Promise<{
    readonly mailboxId: string;
    readonly folderId: string;
    readonly row: StoredMessage;
  }> => {
    const mailboxId = exchangeMailboxId(account);
    const folderIds = folderId ? [folderId] : await listExchangeFolderIds(account);
    let lastError: unknown = null;

    for (const candidateFolderId of folderIds) {
      try {
        const row = await messagesStore
          .mailbox({ mailboxId })
          .folder({ folderId: candidateFolderId })
          .getMessage({ externalId: messageId });
        return { mailboxId, folderId: candidateFolderId, row };
      } catch (error) {
        lastError = error;
        if (!isNotFound(error)) throw error;
      }
    }

    for (const candidateFolderId of folderIds) {
      try {
        const row = await findExchangeMessageByUid(mailboxId, candidateFolderId, messageId);
        return { mailboxId, folderId: candidateFolderId, row };
      } catch (error) {
        lastError = error;
        if (!isNotFound(error)) throw error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error(`Email not found: ${messageId}`);
  };

  const saveExchangeAttachmentFromRow = async (
    account: string,
    mailboxId: string,
    folderId: string,
    row: StoredMessage,
    attachmentId: string | undefined,
    filename: string | undefined,
    targetPath: string
  ): Promise<InboxSaveAttachmentResult> => {
    const email = exchangeStoredEmail(row, account, folderId);
    const attachment = findAttachmentByHandle(email, attachmentId, filename);
    const resolvedAttachmentId = await ensureExchangeAttachmentLoaded(
      mailboxId,
      folderId,
      row.externalId,
      attachment
    );
    const saved = await messagesStore
      .mailbox({ mailboxId })
      .folder({ folderId })
      .message({ externalId: row.externalId })
      .attachments.saveToDrive({ attachmentId: resolvedAttachmentId, targetPath });
    return {
      saved: true,
      entry: {
        id: saved.entry.id,
        name: saved.entry.name,
        path: saved.entry.fullPath ?? targetPath,
        fileId: saved.entry.fileId,
      },
    };
  };

  const saveExchangeAttachmentExact = async (
    account: string,
    folderId: string,
    messageId: string,
    attachmentId: string | undefined,
    filename: string | undefined,
    targetPath: string
  ): Promise<InboxSaveAttachmentResult> => {
    const mailboxId = exchangeMailboxId(account);
    const row = await messagesStore
      .mailbox({ mailboxId })
      .folder({ folderId })
      .getMessage({ externalId: messageId });
    return saveExchangeAttachmentFromRow(
      account,
      mailboxId,
      folderId,
      row,
      attachmentId,
      filename,
      targetPath
    );
  };

  return {
    listAccounts: async (): Promise<InboxAccountList> => {
      const legacyAccounts = await listLegacyAccounts();
      const accountMap = new Map<string, { account: string; displayName: string }>();
      for (const account of legacyAccounts)
        accountMap.set(account, { account, displayName: account });
      try {
        const mailboxes = await messagesStore.listMailboxes();
        for (const mailbox of mailboxes) {
          if (!accountMap.has(mailbox.mailboxId)) {
            accountMap.set(mailbox.mailboxId, {
              account: mailbox.mailboxId,
              displayName: mailbox.displayName,
            });
          }
        }
      } catch {
        // Legacy-only workspaces remain valid.
      }
      const items = [...accountMap.values()].sort((a, b) =>
        a.displayName.localeCompare(b.displayName)
      );
      return { accounts: items.map((item) => item.account), items };
    },

    list: async ({
      account,
      folderId,
      limit = 20,
      cursor,
    }: InboxListParams): Promise<InboxPage> => {
      const selectedFolder = nonEmpty(folderId) ?? DEFAULT_EXCHANGE_FOLDER;
      try {
        const page = await messagesStore
          .mailbox({ mailboxId: exchangeMailboxId(account) })
          .folder({ folderId: selectedFolder })
          .listMessages({ limit, ...(cursor ? { cursor } : {}) });
        return {
          items: page.items.map((row) => exchangeEnvelope(row, account, selectedFolder)),
          nextCursor: page.nextCursor,
          total: page.items.length,
        };
      } catch (error) {
        if (!isNotFound(error)) throw error;
        return listLegacy(account, limit, cursor);
      }
    },

    read: async ({
      account,
      messageId,
      messageRef,
      folderId,
    }: InboxReadParams): Promise<StoredEmail> => {
      const ref = messageRef ? decodeRef(messageRef) : messageId ? decodeRef(messageId) : null;
      if (messageRef && !ref) throw new Error('Invalid messageRef');
      if (ref?.source === 'legacy') return readLegacy(ref.account, ref.messageId);
      if (ref?.source === 'exchange')
        return readExchangeExact(ref.account, ref.folderId, ref.messageId);
      const resolvedAccount = nonEmpty(account);
      const resolvedMessageId = nonEmpty(messageId);
      if (!resolvedAccount || !resolvedMessageId) {
        throw new Error('Either messageRef, or account + messageId is required');
      }
      try {
        return await readExchange(resolvedAccount, resolvedMessageId, folderId);
      } catch (error) {
        if (!isNotFound(error)) throw error;
        return readLegacy(resolvedAccount, resolvedMessageId);
      }
    },

    search: async ({ account, query, folderId, limit = 10 }: InboxSearchParams) => {
      const lower = query.toLowerCase();
      const results: InboxEmailEnvelope[] = [];
      const exchangeFolders = folderId ? [folderId] : await listExchangeFolderIds(account);
      for (const exchangeFolderId of exchangeFolders) {
        if (results.length >= limit) break;
        try {
          const page = await messagesStore
            .mailbox({ mailboxId: exchangeMailboxId(account) })
            .folder({ folderId: exchangeFolderId })
            .listMessages({ limit: SEARCH_SCAN_LIMIT });
          for (const row of page.items) {
            if (results.length >= limit) break;
            const item = exchangeEnvelope(row, account, exchangeFolderId);
            const searchable = [item.subject, item.from.name, item.from.address, item.snippet]
              .join(' ')
              .toLowerCase();
            if (searchable.includes(lower)) results.push(item);
          }
        } catch (error) {
          if (!isNotFound(error)) throw error;
        }
      }
      if (results.length < limit) {
        try {
          const legacy = await listLegacy(account, SEARCH_SCAN_LIMIT);
          for (const item of legacy.items) {
            if (results.length >= limit) break;
            const searchable = [item.subject, item.from.name, item.from.address, item.snippet]
              .join(' ')
              .toLowerCase();
            if (searchable.includes(lower)) results.push(item);
          }
        } catch {
          // Exchange-only accounts remain valid.
        }
      }
      return { results };
    },

    markRead: async ({ account, messageId, messageRef, folderId, isRead }: InboxMarkReadParams) => {
      const ref = messageRef ? decodeRef(messageRef) : messageId ? decodeRef(messageId) : null;
      if (messageRef && !ref) throw new Error('Invalid messageRef');
      if (ref?.source === 'legacy') return markLegacyRead(ref.account, ref.messageId, isRead);
      if (ref?.source === 'exchange')
        return markExchangeRead(ref.account, ref.folderId, ref.messageId, isRead);
      const resolvedAccount = nonEmpty(account);
      const resolvedMessageId = nonEmpty(messageId);
      if (!resolvedAccount || !resolvedMessageId) {
        throw new Error('Either messageRef, or account + messageId is required');
      }
      try {
        return await markExchangeRead(
          resolvedAccount,
          nonEmpty(folderId) ?? DEFAULT_EXCHANGE_FOLDER,
          resolvedMessageId,
          isRead
        );
      } catch (error) {
        if (!isNotFound(error)) throw error;
        return markLegacyRead(resolvedAccount, resolvedMessageId, isRead);
      }
    },

    saveAttachment: async ({
      account,
      messageId,
      messageRef,
      folderId,
      attachmentId,
      filename,
      targetPath,
    }: InboxSaveAttachmentParams): Promise<InboxSaveAttachmentResult> => {
      const ref = messageRef ? decodeRef(messageRef) : messageId ? decodeRef(messageId) : null;
      if (messageRef && !ref) throw new Error('Invalid messageRef');
      const resolvedFilename = nonEmpty(filename);
      if (ref?.source === 'legacy') {
        if (!resolvedFilename) throw new Error('filename is required for legacy attachments');
        return saveLegacyAttachment(ref.account, ref.messageId, resolvedFilename, targetPath);
      }
      if (ref?.source === 'exchange') {
        return saveExchangeAttachmentExact(
          ref.account,
          ref.folderId,
          ref.messageId,
          attachmentId,
          filename,
          targetPath
        );
      }
      const resolvedAccount = nonEmpty(account);
      const resolvedMessageId = nonEmpty(messageId);
      if (!resolvedAccount || !resolvedMessageId) {
        throw new Error('Either messageRef, or account + messageId is required');
      }
      let exchangeMessage: {
        readonly mailboxId: string;
        readonly folderId: string;
        readonly row: StoredMessage;
      } | null = null;
      try {
        exchangeMessage = await resolveExchangeMessageForSave(
          resolvedAccount,
          resolvedMessageId,
          nonEmpty(folderId) ?? undefined
        );
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      if (exchangeMessage) {
        return saveExchangeAttachmentFromRow(
          resolvedAccount,
          exchangeMessage.mailboxId,
          exchangeMessage.folderId,
          exchangeMessage.row,
          attachmentId,
          filename,
          targetPath
        );
      }
      if (!resolvedFilename) throw new Error('filename is required for legacy attachments');
      return saveLegacyAttachment(resolvedAccount, resolvedMessageId, resolvedFilename, targetPath);
    },
  };
};
