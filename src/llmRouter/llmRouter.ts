import type { AuthModule } from '../auth/types.js';
import { resolveDiskdGatewayUrl } from '../env/baseUrl.js';
import { jsonRpcCall } from '../drive/rpc.js';
import type {
  ChatCompletionMessage,
  CompletionParams,
  CompletionResult,
  CompletionUsage,
  EmbeddingParams,
  EmbeddingResult,
  EmbeddingUsage,
  ListModelsResult,
  ListProviderModelsParams,
  ListProviderModelsResult,
  ModelInfo,
  OcrDocument,
  OcrPage,
  OcrParams,
  OcrResult,
  StreamChunk,
  ToolCall,
  TranscribeParams,
  TranscribeResult,
  LlmRouterClient,
} from './llmRouterTypes.js';

// ---------------------------------------------------------------------------
// Decode helpers (wire snake_case -> domain camelCase)
// ---------------------------------------------------------------------------

type RawObject = { readonly [key: string]: unknown };

const isObject = (value: unknown): value is RawObject =>
  typeof value === 'object' && value !== null;

const str = (obj: RawObject, key: string): string | null => {
  const v = obj[key];
  return typeof v === 'string' ? v : null;
};

const strRequired = (obj: RawObject, key: string): string => {
  const v = obj[key];
  if (typeof v !== 'string')
    throw new Error(`Invalid LLM Router response: '${key}' must be a string`);
  return v;
};

const num = (obj: RawObject, key: string): number | null => {
  const v = obj[key];
  return typeof v === 'number' ? v : null;
};

const numRequired = (obj: RawObject, key: string): number => {
  const v = num(obj, key);
  if (v === null)
    throw new Error(`Invalid LLM Router response: '${key}' must be a number`);
  return v;
};

const arr = (obj: RawObject, key: string): readonly unknown[] => {
  const v = obj[key];
  return Array.isArray(v) ? v : [];
};

const raw = (value: unknown): RawObject => {
  if (!isObject(value)) throw new Error('Invalid LLM Router response: expected object');
  return value;
};

// ---------------------------------------------------------------------------
// Decoders
// ---------------------------------------------------------------------------

const decodeToolCall = (o: unknown): ToolCall => {
  const r = raw(o);
  const fn = r.function;
  return {
    index: num(r, 'index'),
    id: str(r, 'id'),
    type: str(r, 'type') === 'function' ? 'function' : null,
    function:
      isObject(fn)
        ? {
            name: str(fn, 'name'),
            arguments: str(fn, 'arguments'),
          }
        : null,
  };
};

const decodeUsage = (o: unknown): CompletionUsage | null => {
  if (!isObject(o)) return null;
  return {
    promptTokens: num(o, 'prompt_tokens') ?? 0,
    completionTokens: num(o, 'completion_tokens') ?? 0,
    totalTokens: num(o, 'total_tokens') ?? 0,
  };
};

const decodeCompletionResult = (result: unknown): CompletionResult => {
  const r = raw(result);
  return {
    id: strRequired(r, 'id'),
    created: numRequired(r, 'created'),
    model: strRequired(r, 'model'),
    usage: decodeUsage(r.usage),
    choices: arr(r, 'choices').map((c) => {
      const cr = raw(c);
      const msg = cr.message;
      const dlt = cr.delta;
      return {
        index: num(cr, 'index') ?? 0,
        finishReason: str(cr, 'finish_reason'),
        message: isObject(msg)
          ? {
              content: str(msg, 'content'),
              role: str(msg, 'role') ?? 'assistant',
              toolCalls: Array.isArray(msg.tool_calls)
                ? msg.tool_calls.map(decodeToolCall)
                : null,
            }
          : null,
        delta: isObject(dlt)
          ? {
              content: str(dlt, 'content'),
              role: str(dlt, 'role'),
              toolCalls: Array.isArray(dlt.tool_calls)
                ? dlt.tool_calls.map(decodeToolCall)
                : null,
            }
          : null,
      };
    }),
  };
};

const decodeStreamChunk = (raw_: unknown): StreamChunk => {
  const r = raw(raw_);
  return {
    id: strRequired(r, 'id'),
    created: numRequired(r, 'created'),
    model: strRequired(r, 'model'),
    usage: decodeUsage(r.usage),
    choices: arr(r, 'choices').map((c) => {
      const cr = raw(c);
      const dlt = cr.delta;
      return {
        index: num(cr, 'index') ?? 0,
        finishReason: str(cr, 'finish_reason'),
        message: null,
        delta: isObject(dlt)
          ? {
              content: str(dlt, 'content'),
              role: str(dlt, 'role'),
              toolCalls: Array.isArray(dlt.tool_calls)
                ? dlt.tool_calls.map(decodeToolCall)
                : null,
            }
          : { content: null, role: null, toolCalls: null },
      };
    }),
  };
};

const decodeEmbeddingUsage = (o: unknown): EmbeddingUsage => {
  if (!isObject(o)) return { promptTokens: 0, totalTokens: 0 };
  return {
    promptTokens: num(o, 'prompt_tokens') ?? 0,
    totalTokens: num(o, 'total_tokens') ?? 0,
  };
};

const decodeEmbeddingResult = (result: unknown): EmbeddingResult => {
  const r = raw(result);
  return {
    model: strRequired(r, 'model'),
    usage: decodeEmbeddingUsage(r.usage),
    data: arr(r, 'data').map((item) => {
      const ir = raw(item);
      const embedding = ir.embedding;
      return {
        index: num(ir, 'index') ?? 0,
        embedding: Array.isArray(embedding)
          ? embedding.filter((v): v is number => typeof v === 'number')
          : [],
      };
    }),
  };
};

const decodeModelInfo = (o: unknown): ModelInfo => {
  const r = raw(o);
  return {
    provider: strRequired(r, 'provider'),
    model: strRequired(r, 'model'),
    displayName: str(r, 'displayName') ?? str(r, 'display_name') ?? strRequired(r, 'model'),
    description: str(r, 'description') ?? '',
    supportedFeatures: arr(r, 'supportedFeatures')
      .concat(arr(r, 'supported_features'))
      .filter((v): v is string => typeof v === 'string'),
  };
};

const decodeOcrImageObject = (o: unknown) => {
  const r = raw(o);
  return {
    id: strRequired(r, 'id'),
    topLeftX: num(r, 'top_left_x'),
    topLeftY: num(r, 'top_left_y'),
    bottomRightX: num(r, 'bottom_right_x'),
    bottomRightY: num(r, 'bottom_right_y'),
    imageBase64: str(r, 'image_base64'),
    imageAnnotation: str(r, 'image_annotation'),
  };
};

const decodeOcrTableObject = (o: unknown) => {
  const r = raw(o);
  return {
    id: strRequired(r, 'id'),
    content: strRequired(r, 'content'),
    format: str(r, 'format') ?? 'markdown',
  };
};

const decodeOcrPage = (o: unknown): OcrPage => {
  const r = raw(o);
  const dims = r.dimensions;
  return {
    index: num(r, 'index') ?? 0,
    markdown: str(r, 'markdown') ?? '',
    images: arr(r, 'images').map(decodeOcrImageObject),
    tables: arr(r, 'tables').map(decodeOcrTableObject),
    hyperlinks: arr(r, 'hyperlinks').filter((v): v is string => typeof v === 'string'),
    header: str(r, 'header'),
    footer: str(r, 'footer'),
    dimensions:
      isObject(dims)
        ? {
            dpi: num(dims, 'dpi') ?? 0,
            height: num(dims, 'height') ?? 0,
            width: num(dims, 'width') ?? 0,
          }
        : null,
  };
};

const decodeOcrResult = (result: unknown): OcrResult => {
  const r = raw(result);
  const usageRaw = r.usage_info;
  return {
    pages: arr(r, 'pages').map(decodeOcrPage),
    model: strRequired(r, 'model'),
    documentAnnotation: str(r, 'document_annotation'),
    usageInfo: isObject(usageRaw)
      ? {
          pagesProcessed: num(usageRaw, 'pages_processed') ?? 0,
          docSizeBytes: num(usageRaw, 'doc_size_bytes'),
        }
      : { pagesProcessed: 0, docSizeBytes: null },
  };
};

const decodeTranscribeResult = (result: unknown): TranscribeResult => {
  const r = raw(result);
  return {
    text: strRequired(r, 'text'),
    language: str(r, 'language'),
    duration: num(r, 'duration'),
    segments: Array.isArray(r.segments)
      ? r.segments.map((s) => {
          const sr = raw(s);
          return {
            text: str(sr, 'text') ?? '',
            start: num(sr, 'start') ?? 0,
            end: num(sr, 'end') ?? 0,
          };
        })
      : null,
  };
};

// ---------------------------------------------------------------------------
// Encode helpers (domain camelCase -> wire snake_case)
// ---------------------------------------------------------------------------

const optional = <T>(key: string, value: T | undefined): Record<string, T> =>
  value !== undefined ? { [key]: value } : {};

const encodeMessageContent = (
  content: string | readonly unknown[],
): unknown => {
  if (typeof content === 'string') return content;
  return content.map((part) => {
    if (!isObject(part)) return part;
    if (part.type === 'image_url') {
      // camelCase imageUrl -> snake_case image_url
      const iu = part.imageUrl;
      return {
        type: 'image_url',
        image_url: isObject(iu) ? iu : { url: iu },
      };
    }
    if (part.type === 'image') {
      const src = part.source;
      if (!isObject(src)) return part;
      return {
        type: 'image',
        source:
          src.type === 'base64'
            ? { type: 'base64', media_type: src.mediaType, data: src.data }
            : { type: 'url', url: src.url },
      };
    }
    return part; // TextContentPart is wire-compatible as-is
  });
};

const encodeMessage = (msg: ChatCompletionMessage): unknown => {
  switch (msg.role) {
    case 'system':
      return { role: 'system', content: msg.content };
    case 'user':
      return { role: 'user', content: encodeMessageContent(msg.content as string | readonly unknown[]) };
    case 'assistant':
      return {
        role: 'assistant',
        content: msg.content,
        ...optional('tool_calls', msg.toolCalls?.map(encodeToolCall)),
      };
    case 'tool':
      return { role: 'tool', content: msg.content, tool_call_id: msg.toolCallId };
  }
};

const encodeToolCall = (tc: ToolCall): unknown => ({
  ...optional('index', tc.index ?? undefined),
  ...optional('id', tc.id ?? undefined),
  ...optional('type', tc.type ?? undefined),
  ...optional(
    'function',
    tc.function
      ? {
          ...optional('name', tc.function.name ?? undefined),
          ...optional('arguments', tc.function.arguments ?? undefined),
        }
      : undefined,
  ),
});

const encodeToolChoice = (
  tc: CompletionParams['toolChoice'],
): unknown => {
  if (tc === undefined) return undefined;
  if (typeof tc === 'string') return tc;
  return { type: 'function', function: { name: tc.function.name } };
};

const encodeResponseFormat = (
  rf: CompletionParams['responseFormat'],
): unknown => {
  if (rf === undefined) return undefined;
  if (rf.type === 'json_object') return { type: 'json_object' };
  return {
    type: 'json_schema',
    json_schema: { name: rf.jsonSchema.name, schema: rf.jsonSchema.schema },
  };
};

const encodeCompletionParams = (params: CompletionParams): Record<string, unknown> => ({
  provider: params.provider,
  model: params.model,
  ...optional('messages', params.messages?.map(encodeMessage)),
  ...optional('prompt', params.prompt),
  ...optional('max_tokens', params.maxTokens),
  ...optional('temperature', params.temperature),
  ...optional('top_p', params.topP),
  ...optional('frequency_penalty', params.frequencyPenalty),
  ...optional('presence_penalty', params.presencePenalty),
  ...optional('stop', params.stop !== undefined ? (params.stop as string | string[]) : undefined),
  ...optional('tools', params.tools as unknown[] | undefined),
  ...optional('tool_choice', encodeToolChoice(params.toolChoice)),
  ...optional('response_format', encodeResponseFormat(params.responseFormat)),
});

const encodeOcrDocument = (doc: OcrDocument): unknown => {
  switch (doc.type) {
    case 'document_url':
      return {
        type: 'document_url',
        document_url: doc.documentUrl,
        ...optional('document_name', doc.documentName ?? undefined),
      };
    case 'image_url':
      return { type: 'image_url', image_url: doc.imageUrl };
    case 'file':
      return { type: 'file', file_id: doc.fileId };
  }
};

const encodeOcrParams = (params: OcrParams): Record<string, unknown> => ({
  model: params.model,
  document: encodeOcrDocument(params.document),
  ...optional('pages', params.pages !== null ? (params.pages as number[] | undefined) : undefined),
  ...optional('include_image_base64', params.includeImageBase64),
  ...optional('image_limit', params.imageLimit),
  ...optional('image_min_size', params.imageMinSize),
  ...optional('table_format', params.tableFormat),
  ...optional('extract_header', params.extractHeader),
  ...optional('extract_footer', params.extractFooter),
});

// ---------------------------------------------------------------------------
// NDJSON streaming reader
// ---------------------------------------------------------------------------

/**
 * Reads a fetch Response body as NDJSON, yielding each parsed JSON value.
 * Empty lines and keep-alive newlines are skipped silently.
 * Lines that contain `{ type: 'error' }` are thrown as errors.
 */
async function* readNdjsonStream(response: Response): AsyncGenerator<unknown, void, unknown> {
  if (!response.body) throw new Error('LLM Router stream: response has no body');

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      // Last element may be an incomplete line -- keep in buffer
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue; // skip keep-alive / empty lines

        let parsed: unknown;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          // Malformed line -- skip; do not abort the stream
          continue;
        }

        if (isObject(parsed) && parsed.type === 'error') {
          const msg = str(parsed, 'message') ?? JSON.stringify(parsed);
          throw new Error(`LLM Router stream error: ${msg}`);
        }

        yield parsed;
      }
    }

    // Flush remaining buffer
    const remaining = buffer.trim();
    if (remaining) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(remaining);
      } catch {
        return;
      }
      if (isObject(parsed) && parsed.type === 'error') {
        const msg = str(parsed, 'message') ?? JSON.stringify(parsed);
        throw new Error(`LLM Router stream error: ${msg}`);
      }
      yield parsed;
    }
  } finally {
    reader.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

/**
 * Creates an LLM Router client bound to a given auth module and optional base URL.
 *
 * The URL defaults to the centralized `DISKD_BASE_URL` gateway with the
 * `/os/llm` path prefix.
 *
 * Example:
 * ```ts
 * const llm = createLlmRouterClient({ auth });
 * const result = await llm.completions.create({
 *   provider: 'openai',
 *   model: 'gpt-4o',
 *   messages: [{ role: 'user', content: 'Hello' }],
 * });
 * ```
 */
export const createLlmRouterClient = (params: {
  readonly auth: AuthModule;
  readonly url?: string;
}): LlmRouterClient => {
  const baseUrl = (params.url ?? resolveDiskdGatewayUrl('os/llm')).replace(/\/+$/, '');
  const invokeUrl = `${baseUrl}/api/v1/invoke`;
  const streamUrl = `${baseUrl}/api/v1/stream`;
  const ocrUrl = `${baseUrl}/api/v1/ocr`;
  const audioTranscribeUrl = `${baseUrl}/api/v1/audio/transcribe`;

  let nextId = 1;

  const getAuthHeaders = async (): Promise<Record<string, string>> => {
    if (params.auth.getRequestHeaders) {
      return params.auth.getRequestHeaders();
    }
    const token = await params.auth.getAccessToken();
    return { Authorization: `Bearer ${token}` };
  };

  const call = async (method: string, rpcParams: unknown): Promise<unknown> => {
    const id = nextId;
    nextId += 1;

    if (params.auth.getRequestHeaders) {
      const headers = await params.auth.getRequestHeaders();
      return jsonRpcCall({ url: invokeUrl, headers, method, rpcParams, id });
    }

    const bearerToken = await params.auth.getAccessToken();
    return jsonRpcCall({ url: invokeUrl, bearerToken, method, rpcParams, id });
  };

  return {
    completions: {
      create: async (completionParams: CompletionParams) => {
        const result = await call('completions/create', encodeCompletionParams(completionParams));
        return decodeCompletionResult(result);
      },

      stream: async function* (completionParams: CompletionParams) {
        const authHeaders = await getAuthHeaders();
        const body = JSON.stringify(encodeCompletionParams(completionParams));

        const response = await fetch(streamUrl, {
          method: 'POST',
          headers: {
            ...authHeaders,
            'Content-Type': 'application/json',
            Accept: 'application/x-ndjson',
          },
          body,
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(
            `LLM Router stream failed (HTTP ${response.status}): ${text.slice(0, 200)}`,
          );
        }

        for await (const raw_ of readNdjsonStream(response)) {
          yield decodeStreamChunk(raw_);
        }
      },
    },

    models: {
      list: async (listParams: ListProviderModelsParams): Promise<ListProviderModelsResult> => {
        const result = await call('models/list', { provider: listParams.provider });
        const r = raw(result);
        return {
          provider: strRequired(r, 'provider'),
          models: arr(r, 'models').filter((v): v is string => typeof v === 'string'),
        };
      },

      listAll: async (): Promise<ListModelsResult> => {
        const result = await call('models/list-all', {});
        const r = raw(result);
        return {
          models: arr(r, 'models').map(decodeModelInfo),
        };
      },
    },

    embeddings: {
      create: async (embeddingParams: EmbeddingParams): Promise<EmbeddingResult> => {
        const result = await call('embeddings/create', {
          provider: embeddingParams.provider,
          model: embeddingParams.model,
          input: embeddingParams.input,
          ...optional('dimensions', embeddingParams.dimensions),
        });
        return decodeEmbeddingResult(result);
      },
    },

    ocr: {
      process: async (ocrParams: OcrParams): Promise<OcrResult> => {
        const authHeaders = await getAuthHeaders();
        const body = JSON.stringify(encodeOcrParams(ocrParams));

        const response = await fetch(ocrUrl, {
          method: 'POST',
          headers: {
            ...authHeaders,
            'Content-Type': 'application/json',
          },
          body,
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(
            `LLM Router OCR failed (HTTP ${response.status}): ${text.slice(0, 200)}`,
          );
        }

        const json = await response.json();
        return decodeOcrResult(json);
      },
    },

    audio: {
      transcribe: async (transcribeParams: TranscribeParams): Promise<TranscribeResult> => {
        const authHeaders = await getAuthHeaders();

        // Build query string from optional scalar params
        const qs = new URLSearchParams();
        qs.set('model', transcribeParams.model ?? 'whisper-large-v3-turbo');
        if (transcribeParams.language !== undefined) qs.set('language', transcribeParams.language);
        if (transcribeParams.prompt !== undefined) qs.set('prompt', transcribeParams.prompt);
        if (transcribeParams.responseFormat !== undefined)
          qs.set('response_format', transcribeParams.responseFormat);
        if (transcribeParams.temperature !== undefined)
          qs.set('temperature', String(transcribeParams.temperature));

        const url = `${audioTranscribeUrl}?${qs.toString()}`;

        // Normalise the audio payload to an ArrayBuffer for BodyInit compatibility.
        // Slice the Uint8Array view into a fresh ArrayBuffer to avoid SharedArrayBuffer
        // variants that fetch() does not accept.
        const audioBuffer: ArrayBuffer =
          transcribeParams.audio instanceof Uint8Array
            ? (transcribeParams.audio.buffer as ArrayBuffer).slice(
                transcribeParams.audio.byteOffset,
                transcribeParams.audio.byteOffset + transcribeParams.audio.byteLength,
              )
            : (transcribeParams.audio as ArrayBuffer);

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            ...authHeaders,
            'Content-Type': 'audio/mpeg', // provider-level detection is done server-side
          },
          body: audioBuffer,
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(
            `LLM Router audio/transcribe failed (HTTP ${response.status}): ${text.slice(0, 200)}`,
          );
        }

        const json = await response.json();
        return decodeTranscribeResult(json);
      },
    },
  };
};
