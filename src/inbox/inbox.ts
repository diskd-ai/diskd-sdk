import { createMcpToolsClient } from '../mcpTools/mcpTools.js';
import type { McpToolsClient } from '../mcpTools/mcpToolsTypes.js';
import { createMessagesStoreClient } from '../messagesStore/messagesStore.js';
import type {
  FolderSummary,
  MailboxSummary,
  MessagesStoreClient,
  StoredMessage,
} from '../messagesStore/messagesStoreTypes.js';
import {
  Err,
  formatInboxMessageSearchQuery,
  formatInboxSearchQueryError,
  type InboxFolderScope,
  Ok,
  parseInboxSearchQuery,
  type Result,
} from './inboxSearchQuery.js';
import type {
  InboxAccountList,
  InboxClient,
  InboxClientParams,
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
const DEFAULT_SEARCH_PAGE_SIZE = 20;
const MAX_SEARCH_PAGE_SIZE = 100;
const MESSAGE_LOOKUP_SCAN_LIMIT = 100;
const SYSTEM_HYDRATE_EMAIL_BODIES_TOOL = 'system_hydrate_email_bodies';
const SYSTEM_HYDRATE_EMAIL_ATTACHMENT_TOOL = 'system_hydrate_email_attachment';

type RawObject = { readonly [key: string]: unknown };

type InboxFolderResolutionError =
  | { readonly tag: 'FolderNotFound'; readonly selector: string }
  | {
      readonly tag: 'FolderAmbiguous';
      readonly selector: string;
      readonly folderIds: readonly string[];
    }
  | { readonly tag: 'FolderDelimiterMissing'; readonly folderId: string };

const isObject = (value: unknown): value is RawObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === 'string';
const isBool = (value: unknown): value is boolean => typeof value === 'boolean';
const isNumber = (value: unknown): value is number => typeof value === 'number';

const nonEmpty = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
};

/** Keep Inbox first while preserving the provider's remaining folder order. */
const orderExchangeFolders = (folders: readonly FolderSummary[]): readonly FolderSummary[] => {
  const inbox = folders.find((folder) => folder.folderId === DEFAULT_EXCHANGE_FOLDER);
  if (!inbox) return folders;
  return [inbox, ...folders.filter((folder) => folder.folderId !== DEFAULT_EXCHANGE_FOLDER)];
};

/** Resolve exact folder paths before requiring a unique display-name match. */
const resolveFolderScope = (
  folders: readonly FolderSummary[],
  scope: Extract<InboxFolderScope, { readonly tag: 'FolderTree' }>
): Result<InboxFolderResolutionError, readonly FolderSummary[]> => {
  const exact = folders.find((folder) => folder.folderId === scope.selector);
  const displayMatches = folders.filter((folder) => folder.displayName === scope.selector);
  const selected = exact ?? (displayMatches.length === 1 ? displayMatches[0] : undefined);
  if (!selected) {
    if (displayMatches.length > 1) {
      return Err({
        tag: 'FolderAmbiguous',
        selector: scope.selector,
        folderIds: displayMatches.map((folder) => folder.folderId),
      });
    }
    return Err({ tag: 'FolderNotFound', selector: scope.selector });
  }
  if (!scope.recursive) return Ok([selected]);

  const delimiter = isString(selected.metadata.delimiter)
    ? nonEmpty(selected.metadata.delimiter)
    : null;
  if (!delimiter) return Err({ tag: 'FolderDelimiterMissing', folderId: selected.folderId });
  const descendantPrefix = selected.folderId.endsWith(delimiter)
    ? selected.folderId
    : `${selected.folderId}${delimiter}`;
  return Ok(
    folders.filter(
      (folder) =>
        folder.folderId === selected.folderId || folder.folderId.startsWith(descendantPrefix)
    )
  );
};

/** Surface folder-resolution failures as stable Inbox client error codes. */
const formatFolderResolutionError = (error: InboxFolderResolutionError): string => {
  switch (error.tag) {
    case 'FolderNotFound':
      return `INBOX_FOLDER_NOT_FOUND: no folder matches ${JSON.stringify(error.selector)}`;
    case 'FolderAmbiguous':
      return `INBOX_FOLDER_AMBIGUOUS: ${JSON.stringify(error.selector)} matches ${error.folderIds.map((folderId) => JSON.stringify(folderId)).join(', ')}`;
    case 'FolderDelimiterMissing':
      return `INBOX_FOLDER_DELIMITER_MISSING: folder ${JSON.stringify(error.folderId)} has no provider delimiter metadata`;
  }
};

/** Validate the Drive scan-page size without conflating it with result limit. */
const resolveSearchPageSize = (pageSize: number | undefined): number => {
  const value = pageSize ?? DEFAULT_SEARCH_PAGE_SIZE;
  if (!Number.isInteger(value) || value < 1 || value > MAX_SEARCH_PAGE_SIZE) {
    throw new Error(`pageSize must be an integer between 1 and ${MAX_SEARCH_PAGE_SIZE}`);
  }
  return value;
};

const exchangeMailboxId = (account: string): string => {
  const lower = account.toLowerCase();
  const slug = lower.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (slug.length === 0) return 'exchange-default';
  if (slug.startsWith('exchange-')) return slug.slice(0, 64);
  return `exchange-${slug.slice(0, 55)}`;
};

/** Keep the Inbox account projection limited to mailboxes owned by Exchange ingestion. */
const isConnectedInboxMailbox = (mailbox: MailboxSummary): boolean =>
  mailbox.mailboxId.startsWith('exchange-');

const EMAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validate opaque Drive metadata at the typed Inbox projection boundary. */
const inboxAccountFromMailbox = (mailbox: MailboxSummary): InboxAccountList['items'][number] => {
  const rawEmail = mailbox.metadata.email;
  if (typeof rawEmail !== 'string' || rawEmail.trim().length === 0) {
    return {
      status: 'unavailable',
      account: mailbox.mailboxId,
      displayName: mailbox.displayName,
      reason: 'missing-email-metadata',
    };
  }
  const email = rawEmail.trim();
  if (!EMAIL_ADDRESS_PATTERN.test(email)) {
    return {
      status: 'unavailable',
      account: mailbox.mailboxId,
      displayName: mailbox.displayName,
      reason: 'invalid-email-metadata',
    };
  }
  return {
    status: 'searchable',
    account: mailbox.mailboxId,
    email,
    displayName: mailbox.displayName,
  };
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

const envelopeFromStoredEmail = (email: StoredEmail): InboxEmailEnvelope => ({
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
});

const exchangeEnvelope = (
  row: StoredMessage,
  account: string,
  folderId: string
): InboxEmailEnvelope => envelopeFromStoredEmail(exchangeStoredEmail(row, account, folderId));

/** Identify one RFC message across its repeated folder projections. */
const storedMessageIdentity = (row: StoredMessage, folderId: string): string => {
  const providerMessageId = payloadObject(row).messageId;
  if (isString(providerMessageId) && providerMessageId.trim().length > 0) {
    return `rfc:${providerMessageId.trim().toLowerCase()}`;
  }
  return `stored:${folderId}:${row.externalId}`;
};

/** Order mailbox-wide search envelopes by received time with stable ties. */
const compareEnvelopeNewestFirst = (
  left: InboxEmailEnvelope,
  right: InboxEmailEnvelope
): number => {
  const leftTime = Date.parse(left.date);
  const rightTime = Date.parse(right.date);
  const timeDifference =
    (Number.isFinite(rightTime) ? rightTime : Number.NEGATIVE_INFINITY) -
    (Number.isFinite(leftTime) ? leftTime : Number.NEGATIVE_INFINITY);
  if (timeDifference !== 0) return timeDifference;
  return `${left.folderId}\u0000${left.messageId}`.localeCompare(
    `${right.folderId}\u0000${right.messageId}`
  );
};

/** Build the domain identity used for optional search-result deduplication. */
const inboxSearchDistinctKey = (
  envelope: InboxEmailEnvelope,
  distinctBy: Exclude<NonNullable<InboxSearchParams['distinctBy']>, 'none'>
): string => {
  if (distinctBy === 'subject') {
    const subject = envelope.subject.trim().toLowerCase();
    return subject.length > 0 ? subject : `message:${envelope.messageId}`;
  }
  const address = envelope.from.address.trim().toLowerCase();
  if (address.length > 0) return address;
  const name = envelope.from.name.trim().toLowerCase();
  return name.length > 0 ? name : `message:${envelope.messageId}`;
};

/** Apply caller-selected ordering and deduplication before the result limit. */
const selectInboxSearchResults = (
  envelopes: readonly InboxEmailEnvelope[],
  params: Pick<InboxSearchParams, 'distinctBy' | 'limit' | 'order'>
): readonly InboxEmailEnvelope[] => {
  const ordered =
    params.order === undefined
      ? [...envelopes]
      : [...envelopes].sort((left, right) => {
          const newestFirst = compareEnvelopeNewestFirst(left, right);
          return params.order === 'oldest' ? -newestFirst : newestFirst;
        });
  const distinctBy = params.distinctBy ?? 'none';
  if (distinctBy === 'none') return ordered.slice(0, params.limit);

  const selected: InboxEmailEnvelope[] = [];
  const seen = new Set<string>();
  for (const envelope of ordered) {
    const key = inboxSearchDistinctKey(envelope, distinctBy);
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(envelope);
    if (selected.length >= (params.limit ?? 10)) break;
  }
  return selected;
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

export const createInboxClient = (params: InboxClientParams): InboxClient => {
  const messagesStore: MessagesStoreClient = createMessagesStoreClient({
    auth: params.auth,
    url: params.driveUrl,
  });
  const mcpTools: McpToolsClient | null =
    params.contentMode === 'stored-only'
      ? null
      : createMcpToolsClient({ auth: params.auth, url: params.mcpUrl });
  let hydrateBodyToolName: string | null = null;
  let hydrateAttachmentToolName: string | null = null;

  const listExchangeFolders = async (
    account: string,
    signal?: AbortSignal
  ): Promise<readonly FolderSummary[]> => {
    const folders = await messagesStore
      .mailbox({ mailboxId: exchangeMailboxId(account) })
      .listFolders(signal);
    if (folders.length > 0) return orderExchangeFolders(folders);
    return [
      {
        folderId: DEFAULT_EXCHANGE_FOLDER,
        displayName: DEFAULT_EXCHANGE_FOLDER,
        metadata: {},
        messageCount: 0,
        updatedAt: '',
      },
    ];
  };

  /** Project folder summaries to IDs for legacy read/mark operations. */
  const listExchangeFolderIds = async (
    account: string,
    signal?: AbortSignal
  ): Promise<readonly string[]> =>
    (await listExchangeFolders(account, signal)).map((folder) => folder.folderId);

  const hydrateBody = async (
    mailboxId: string,
    folderId: string,
    externalId: string
  ): Promise<void> => {
    if (!mcpTools) {
      throw new Error(`Inbox body is not stored in Drive messagebox: ${externalId}`);
    }
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
    if (!mcpTools) {
      throw new Error(`Inbox attachment is not stored in Drive messagebox: ${attachmentId}`);
    }
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
        .listMessages({ limit: MESSAGE_LOOKUP_SCAN_LIMIT, ...(cursor ? { cursor } : {}) });
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
        .filter(isConnectedInboxMailbox)
        .map(inboxAccountFromMailbox)
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

    search: async (
      { account, query, folderId, limit = 10, pageSize, order, distinctBy }: InboxSearchParams,
      signal?: AbortSignal
    ) => {
      const uniqueResults = new Map<string, InboxEmailEnvelope>();
      const mailboxId = exchangeMailboxId(account);
      const resolvedPageSize = resolveSearchPageSize(pageSize);
      const parsedQuery = parseInboxSearchQuery(query);
      if (parsedQuery.tag === 'Err') {
        throw new Error(formatInboxSearchQueryError(parsedQuery.error));
      }
      const messageQuery = formatInboxMessageSearchQuery(parsedQuery.value);
      const explicitFolderId = nonEmpty(folderId) ?? undefined;
      if (explicitFolderId && parsedQuery.value.folderScope.tag === 'FolderTree') {
        throw new Error(
          'INBOX_FOLDER_SELECTOR_CONFLICT: use either folderId or folder: in query, not both'
        );
      }

      let exchangeFolders: readonly string[];
      if (explicitFolderId) {
        exchangeFolders = [explicitFolderId];
      } else {
        const folders = await listExchangeFolders(account, signal);
        if (parsedQuery.value.folderScope.tag === 'AllFolders') {
          exchangeFolders = folders.map((folder) => folder.folderId);
        } else {
          const resolved = resolveFolderScope(folders, parsedQuery.value.folderScope);
          if (resolved.tag === 'Err') {
            throw new Error(formatFolderResolutionError(resolved.error));
          }
          exchangeFolders = resolved.value.map((folder) => folder.folderId);
        }
      }

      const selectionOrder = order ?? 'newest';
      const searchOrderBy = selectionOrder === 'oldest' ? 'message_date_asc' : 'message_date_desc';
      for (const exchangeFolderId of exchangeFolders) {
        const folder = messagesStore.mailbox({ mailboxId }).folder({ folderId: exchangeFolderId });
        const folderCandidates: Array<{
          readonly identity: string;
          readonly envelope: InboxEmailEnvelope;
        }> = [];
        const folderIdentities = new Set<string>();
        let cursor: string | undefined;
        do {
          const page =
            messageQuery.tag === 'Some'
              ? await folder.searchMessages(
                  {
                    query: messageQuery.value,
                    pageSize: resolvedPageSize,
                    ...(cursor ? { cursor } : {}),
                    orderBy: searchOrderBy,
                  },
                  signal
                )
              : await folder.listMessages(
                  {
                    limit: resolvedPageSize,
                    orderBy: 'message_date_desc',
                    ...(cursor ? { cursor } : {}),
                  },
                  signal
                );
          for (const row of page.items) {
            const envelope = exchangeEnvelope(row, account, exchangeFolderId);
            const identity = storedMessageIdentity(row, exchangeFolderId);
            if (folderIdentities.has(identity)) continue;
            folderIdentities.add(identity);
            folderCandidates.push({ identity, envelope });
          }
          cursor = page.nextCursor ?? undefined;
          const canStopAtSelection = messageQuery.tag === 'Some' || selectionOrder === 'newest';
          if (
            canStopAtSelection &&
            selectInboxSearchResults(
              folderCandidates.map((candidate) => candidate.envelope),
              { limit, order: selectionOrder, ...(distinctBy !== undefined ? { distinctBy } : {}) }
            ).length >= limit
          ) {
            cursor = undefined;
          }
        } while (cursor);

        const selectedFolderEnvelopes = new Set(
          selectInboxSearchResults(
            folderCandidates.map((candidate) => candidate.envelope),
            { limit, order: selectionOrder, ...(distinctBy !== undefined ? { distinctBy } : {}) }
          )
        );
        for (const candidate of folderCandidates) {
          if (
            selectedFolderEnvelopes.has(candidate.envelope) &&
            !uniqueResults.has(candidate.identity)
          ) {
            uniqueResults.set(candidate.identity, candidate.envelope);
          }
        }
      }
      return {
        results: selectInboxSearchResults([...uniqueResults.values()], {
          limit,
          order: selectionOrder,
          ...(distinctBy !== undefined ? { distinctBy } : {}),
        }),
      };
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
