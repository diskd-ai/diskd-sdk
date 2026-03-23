// Stored email types.
// These describe the JSON format of email files on Drive at /.profile/mail/<account>/inbox/.
// Shared between app-service (writer) and agent-service (reader).

// -- Contact --

export type StoredEmailContact = {
  readonly name: string;
  readonly address: string;
};

// -- Attachment --

export type StoredEmailAttachment = {
  readonly filename: string;
  readonly contentType: string;
  readonly size: number;
  readonly drivePath: string;
};

// -- Full stored email (JSON file on Drive) --

export type StoredEmail = {
  readonly messageId: string;
  readonly uid: number | null;
  readonly account: string;
  readonly folder: string;
  readonly from: StoredEmailContact;
  readonly to: readonly StoredEmailContact[];
  readonly cc: readonly StoredEmailContact[];
  readonly subject: string;
  readonly date: string;
  readonly receivedAt: string;
  readonly snippet: string;
  readonly bodyText: string;
  readonly bodyHtml: string;
  readonly hasAttachments: boolean;
  readonly attachments: readonly StoredEmailAttachment[];
  readonly labels: readonly string[];
  readonly isRead: boolean;
  readonly isFlagged: boolean;
  readonly priority: string;
  readonly webhookEvent: string;
  readonly rule: string | null;
};
