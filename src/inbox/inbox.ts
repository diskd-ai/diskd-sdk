import type { AuthModule } from '../auth/types.js';
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

const DEFAULT_EXCHANGE_FOLDER = 'INBOX';
const SEARCH_SCAN_LIMIT = 100;
const SYSTEM_HYDRATE_EMAIL_BODIES_TOOL = 'system_hydrate_email_bodies';
const SYSTEM_HYDRATE_EMAIL_ATTACHMENT_TOOL = 'system_hydrate_email_attachment';

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

const exchangeAttachmentId = (payload: RawObject, attachment: RawObject): string | null => {
  if (isString(attachment.attachmentId) && attachment.attachmentId.trim().length > 0) {
    return attachment.attachmentId;
  }
  if (!isNumber(payload.uidValidity) || !isNumber(payload.uid) || !isString(attachment.partId)) {
    return null;
  }
  const partId = attachment.partId.trim();
  return partId.length > 0 ? `${payload.uidValidity}:${payload.uid}:${partId}` : null;
};

const parseAttachment = (value: unknown, attachmentId?: string | null): StoredEmailAttachment => {
  if (!isObject(value)) {
    return { filename: '', contentType: '', size: 0, drivePath: '' };
  }
  const resolvedAttachmentId =
    attachmentId ?? (isString(value.attachmentId) ? value.attachmentId : null);
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
    ...(resolvedAttachmentId ? { attachmentId: resolvedAttachmentId } : {}),
    ...(isString(value.storageState) ? { storageState: value.storageState } : {}),
    ...(isNumber(value.storedSizeBytes) ? { storedSizeBytes: value.storedSizeBytes } : {}),
    ...(isString(value.storedAt) ? { storedAt: value.storedAt } : {}),
    ...(isString(value.lastLoadError) ? { lastLoadError: value.lastLoadError } : {}),
  };
};

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
    attachments: Array.isArray(payload.attachments)
      ? payload.attachments.map((attachment) =>
          parseAttachment(
            attachment,
            isObject(attachment) ? exchangeAttachmentId(payload, attachment) : null
          )
        )
      : [],
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
  const messagesStore: MessagesStoreClient = createMessagesStoreClient({
    auth: params.auth,
    url: params.driveUrl,
  });
  const mcpTools = createMcpToolsClient({ auth: params.auth, url: params.mcpUrl });
  let hydrateBodyToolName: string | null = null;
  let hydrateAttachmentToolName: string | null = null;

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

  const readExchange = async (
    account: string,
    messageId: string,
    folderId?: string
  ): Promise<StoredEmail> => {
    const resolved = await resolveExchangeMessage(account, messageId, folderId);
    let row = resolved.row;
    if (shouldHydrateBody(row)) {
      await hydrateBody(resolved.mailboxId, resolved.folderId, row.externalId);
      row = await messagesStore
        .mailbox({ mailboxId: resolved.mailboxId })
        .folder({ folderId: resolved.folderId })
        .getMessage({ externalId: row.externalId });
    }
    return exchangeStoredEmail(row, account, resolved.folderId);
  };

  const markExchangeRead = async (
    account: string,
    folderId: string | undefined,
    messageId: string,
    isRead: boolean
  ): Promise<StoredEmail> => {
    const resolved = await resolveExchangeMessage(account, messageId, folderId);
    const folder = messagesStore
      .mailbox({ mailboxId: resolved.mailboxId })
      .folder({ folderId: resolved.folderId });
    await folder.upsertBatch({
      items: [
        { externalId: resolved.row.externalId, payload: { ...resolved.row.payload, isRead } },
      ],
    });
    return exchangeStoredEmail(
      { ...resolved.row, payload: { ...resolved.row.payload, isRead } },
      account,
      resolved.folderId
    );
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

  const resolveExchangeMessage = async (
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

  return {
    listAccounts: async (): Promise<InboxAccountList> => {
      const mailboxes = await messagesStore.listMailboxes();
      const items = mailboxes
        .map((mailbox) => ({
          account: mailbox.mailboxId,
          displayName: mailbox.displayName,
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
      return { accounts: items.map((item) => item.account), items };
    },

    list: async ({
      account,
      folderId,
      limit = 20,
      cursor,
    }: InboxListParams): Promise<InboxPage> => {
      const selectedFolder = nonEmpty(folderId) ?? DEFAULT_EXCHANGE_FOLDER;
      const page = await messagesStore
        .mailbox({ mailboxId: exchangeMailboxId(account) })
        .folder({ folderId: selectedFolder })
        .listMessages({ limit, ...(cursor ? { cursor } : {}) });
      return {
        items: page.items.map((row) => exchangeEnvelope(row, account, selectedFolder)),
        nextCursor: page.nextCursor,
        total: page.items.length,
      };
    },

    read: async ({ account, messageId, folderId }: InboxReadParams): Promise<StoredEmail> => {
      const resolvedAccount = nonEmpty(account);
      const resolvedMessageId = nonEmpty(messageId);
      if (!resolvedAccount || !resolvedMessageId) {
        throw new Error('account + messageId is required');
      }
      return readExchange(resolvedAccount, resolvedMessageId, folderId);
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
      return { results };
    },

    markRead: async ({ account, messageId, folderId, isRead }: InboxMarkReadParams) => {
      const resolvedAccount = nonEmpty(account);
      const resolvedMessageId = nonEmpty(messageId);
      if (!resolvedAccount || !resolvedMessageId) {
        throw new Error('account + messageId is required');
      }
      return markExchangeRead(
        resolvedAccount,
        nonEmpty(folderId) ?? undefined,
        resolvedMessageId,
        isRead
      );
    },

    saveAttachment: async ({
      account,
      messageId,
      folderId,
      attachmentId,
      filename,
      targetPath,
    }: InboxSaveAttachmentParams): Promise<InboxSaveAttachmentResult> => {
      const resolvedAccount = nonEmpty(account);
      const resolvedMessageId = nonEmpty(messageId);
      if (!resolvedAccount || !resolvedMessageId) {
        throw new Error('account + messageId is required');
      }
      const exchangeMessage = await resolveExchangeMessage(
        resolvedAccount,
        resolvedMessageId,
        nonEmpty(folderId) ?? undefined
      );
      return saveExchangeAttachmentFromRow(
        resolvedAccount,
        exchangeMessage.mailboxId,
        exchangeMessage.folderId,
        exchangeMessage.row,
        attachmentId,
        filename,
        targetPath
      );
    },
  };
};
