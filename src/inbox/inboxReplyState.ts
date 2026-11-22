/* REQ-3894-017: StoredEmail and InboxEmailEnvelope carry inReplyTo, references and answered from the stored payload; missing or malformed values map to null, [] and false. */

/**
 * Reply state of one stored message. The mail workers store the RFC In-Reply-To and
 * References ids and the IMAP flags verbatim in the Drive payload; consumers use these
 * values to tell which received messages were answered (#3894).
 */
export type InboxReplyState = {
  /** First RFC In-Reply-To id (`<...>`), trimmed; null when the payload has none. */
  readonly inReplyTo: string | null;
  /** RFC References ids in stored order, trimmed; empty when the payload has none. */
  readonly references: readonly string[];
  /** True when the stored IMAP flags contain \Answered. */
  readonly answered: boolean;
};

type RawPayload = { readonly [key: string]: unknown };

const _isRawPayload = (value: unknown): value is RawPayload =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const _trimmedId = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

const _hasAnsweredFlag = (flags: unknown): boolean =>
  Array.isArray(flags) &&
  flags.some((flag) => typeof flag === 'string' && flag.toLowerCase() === '\\answered');

/**
 * Read the reply state from an untyped stored payload. Every missing or malformed value maps
 * explicitly: a non-string or blank inReplyTo to null, a non-array references to [] (keeping
 * only its non-blank string entries otherwise), and flags without \Answered to false.
 */
export const replyStateOf = (payload: unknown): InboxReplyState => {
  const raw: RawPayload = _isRawPayload(payload) ? payload : {};
  return {
    inReplyTo: _trimmedId(raw.inReplyTo),
    references: Array.isArray(raw.references)
      ? raw.references.flatMap((entry) => {
          const id = _trimmedId(entry);
          return id === null ? [] : [id];
        })
      : [],
    answered: _hasAnsweredFlag(raw.flags),
  };
};
