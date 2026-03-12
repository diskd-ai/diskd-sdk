// Domain types for the LLM Router API methods.
// These are pure data types only -- no classes, no I/O, no side effects.
// snake_case <-> camelCase conversion happens at the wire level (rpc.ts / llmRouter.ts).

// -- Shared vocabulary --

export type LlmRole = 'system' | 'user' | 'assistant' | 'tool';

export type LlmFinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter' | string;

// -- Message content parts --

/** Plain-text segment within a multi-part message. */
export type TextContentPart = {
  readonly type: 'text';
  readonly text: string;
};

/** Image referenced by URL (OpenAI-style). */
export type ImageUrlContentPart = {
  readonly type: 'image_url';
  readonly imageUrl: {
    readonly url: string;
  };
};

/** Image provided as base64 data or a URL (Anthropic-style source block). */
export type ImageContentPart = {
  readonly type: 'image';
  readonly source:
    | {
        readonly type: 'base64';
        readonly mediaType: string | null;
        readonly data: string;
      }
    | {
        readonly type: 'url';
        readonly url: string;
      };
};

/** Discriminated union of all inline content part variants. */
export type MessageContentPart = TextContentPart | ImageUrlContentPart | ImageContentPart;

/** The body of a message: either a plain string or a sequence of parts. */
export type MessageContent = string | readonly MessageContentPart[];

// -- Tool call types --

/** A single function invocation emitted by the model. */
export type ToolCall = {
  readonly index: number | null;
  readonly id: string | null;
  readonly type: 'function' | null;
  readonly function: {
    readonly name: string | null;
    readonly arguments: string | null;
  } | null;
};

// -- Chat completion messages (discriminated union by role) --

/** System instruction message. */
export type SystemMessage = {
  readonly role: 'system';
  readonly content: string;
};

/** User turn message, may include mixed text/image parts. */
export type UserMessage = {
  readonly role: 'user';
  readonly content: MessageContent;
};

/** Assistant response, optionally containing tool-call requests. */
export type AssistantMessage = {
  readonly role: 'assistant';
  readonly content: string | null;
  readonly toolCalls?: readonly ToolCall[];
};

/** Tool execution result sent back to the model. */
export type ToolMessage = {
  readonly role: 'tool';
  readonly content: string;
  readonly toolCallId: string;
};

/**
 * Discriminated union for all message types accepted by completion endpoints.
 * Narrow on `role` to access role-specific fields without unsafe casts.
 */
export type ChatCompletionMessage = SystemMessage | UserMessage | AssistantMessage | ToolMessage;

// -- Tool / function definition --

/**
 * A callable tool exposed to the model.
 * `parameters` is a JSON Schema object; kept as `object` to remain
 * compatible with arbitrary schema shapes without resorting to `unknown`.
 */
export type ToolDefinition = {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description?: string;
    readonly parameters: object;
  };
};

/** How the model should select tools during generation. */
export type ToolChoice =
  | 'auto'
  | 'none'
  | { readonly type: 'function'; readonly function: { readonly name: string } };

// -- Response format --

export type ResponseFormat =
  | { readonly type: 'json_object' }
  | {
      readonly type: 'json_schema';
      readonly jsonSchema: {
        readonly name: string;
        readonly schema: object;
      };
    };

// -- Completion params & result --

/**
 * Parameters for a chat or text completion request.
 * Either `messages` or `prompt` must be provided.
 */
export type CompletionParams = {
  readonly provider: string;
  readonly model: string;
  readonly messages?: readonly ChatCompletionMessage[];
  readonly prompt?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly topP?: number;
  readonly frequencyPenalty?: number;
  readonly presencePenalty?: number;
  readonly stop?: string | readonly string[];
  readonly stream?: boolean;
  readonly tools?: readonly ToolDefinition[];
  readonly toolChoice?: ToolChoice;
  readonly responseFormat?: ResponseFormat;
};

/** Usage counters returned alongside a completion. */
export type CompletionUsage = {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
};

/** A single completion alternative (non-streaming or final chunk). */
export type CompletionChoice = {
  readonly index: number;
  readonly finishReason: LlmFinishReason | null;
  /** Present in non-streaming responses. */
  readonly message: {
    readonly content: string | null;
    readonly role: string;
    readonly toolCalls: readonly ToolCall[] | null;
  } | null;
  /** Present in streaming chunks. */
  readonly delta: {
    readonly content: string | null;
    readonly role: string | null;
    readonly toolCalls: readonly ToolCall[] | null;
  } | null;
};

/**
 * A complete (non-streaming) completion response.
 * `usage` may be absent on some providers.
 */
export type CompletionResult = {
  readonly id: string;
  readonly choices: readonly CompletionChoice[];
  readonly created: number;
  readonly model: string;
  readonly usage: CompletionUsage | null;
};

/**
 * A single streaming chunk. Same shape as `CompletionResult` except
 * `choices[].delta` is populated instead of `choices[].message`.
 */
export type StreamChunk = {
  readonly id: string;
  readonly choices: readonly CompletionChoice[];
  readonly created: number;
  readonly model: string;
  readonly usage: CompletionUsage | null;
};

// -- Embedding params & result --

/**
 * Parameters for an embedding request.
 * `input` may be a single string or a batch of strings.
 */
export type EmbeddingParams = {
  readonly provider: string;
  readonly model: string;
  readonly input: string | readonly string[];
  readonly dimensions?: number;
};

/** A single embedding vector with its position in the batch. */
export type EmbeddingObject = {
  readonly index: number;
  readonly embedding: readonly number[];
};

/** Usage counters for embedding requests (no completion tokens). */
export type EmbeddingUsage = {
  readonly promptTokens: number;
  readonly totalTokens: number;
};

/** Batch embedding response. */
export type EmbeddingResult = {
  readonly data: readonly EmbeddingObject[];
  readonly model: string;
  readonly usage: EmbeddingUsage;
};

// -- Model & provider info --

/**
 * Metadata for a single model offered by a provider.
 * `supportedFeatures` lists capability tags, e.g. `['vision', 'tools', 'streaming']`.
 */
export type ModelInfo = {
  readonly provider: string;
  readonly model: string;
  readonly displayName: string;
  readonly description: string;
  readonly supportedFeatures: readonly string[];
};

/** Result of listing all models across providers. */
export type ListModelsResult = {
  readonly models: readonly ModelInfo[];
};

/** Parameters for listing models from a single provider. */
export type ListProviderModelsParams = {
  readonly provider: string;
};

/** Result of listing models from a single provider (raw model id strings). */
export type ListProviderModelsResult = {
  readonly provider: string;
  readonly models: readonly string[];
};

// -- OCR types --

/** OCR source: a document accessed by URL (PDF, DOCX, etc.). */
export type OcrDocumentUrl = {
  readonly type: 'document_url';
  readonly documentUrl: string;
  readonly documentName: string | null;
};

/** OCR source: a single image accessed by URL. */
export type OcrImageUrl = {
  readonly type: 'image_url';
  readonly imageUrl: string;
};

/** OCR source: a file referenced by its ID in the provider's file store. */
export type OcrFileRef = {
  readonly type: 'file';
  readonly fileId: string;
};

/**
 * Discriminated union of all document input variants for OCR.
 * Narrow on `type` to determine which field holds the reference.
 */
export type OcrDocument = OcrDocumentUrl | OcrImageUrl | OcrFileRef;

/** Parameters for an OCR processing request. */
export type OcrParams = {
  readonly model: string;
  readonly document: OcrDocument;
  /** Restrict processing to specific page numbers (1-based). */
  readonly pages: readonly number[] | null;
  /** Include base64-encoded images of extracted figures. */
  readonly includeImageBase64?: boolean;
  /** Maximum number of images to extract per page. */
  readonly imageLimit?: number;
  /** Minimum pixel dimension for included images. */
  readonly imageMinSize?: number;
  /** Render extracted tables as `'markdown'` or `'html'`. */
  readonly tableFormat?: 'markdown' | 'html';
  readonly extractHeader?: boolean;
  readonly extractFooter?: boolean;
};

/** An image object extracted from an OCR page. */
export type OcrImageObject = {
  readonly id: string;
  readonly topLeftX: number | null;
  readonly topLeftY: number | null;
  readonly bottomRightX: number | null;
  readonly bottomRightY: number | null;
  readonly imageBase64: string | null;
  readonly imageAnnotation: string | null;
};

/** A table object extracted from an OCR page. */
export type OcrTableObject = {
  readonly id: string;
  readonly content: string;
  readonly format: string;
};

/** Physical dimensions of a processed page. */
export type OcrPageDimensions = {
  readonly dpi: number;
  readonly height: number;
  readonly width: number;
};

/** Structured content extracted from a single page. */
export type OcrPage = {
  readonly index: number;
  readonly markdown: string;
  readonly images: readonly OcrImageObject[];
  readonly tables: readonly OcrTableObject[];
  readonly hyperlinks: readonly string[];
  readonly header: string | null;
  readonly footer: string | null;
  readonly dimensions: OcrPageDimensions | null;
};

/** Billing / throughput counters for an OCR response. */
export type OcrUsageInfo = {
  readonly pagesProcessed: number;
  readonly docSizeBytes: number | null;
};

/** Full response from an OCR processing request. */
export type OcrResult = {
  readonly pages: readonly OcrPage[];
  readonly model: string;
  readonly documentAnnotation: string | null;
  readonly usageInfo: OcrUsageInfo;
};

// -- Audio transcription types --

/**
 * Parameters for an audio-to-text transcription request.
 * `audio` is the raw audio bytes; format detection is provider-specific.
 */
export type TranscribeParams = {
  readonly provider: string;
  readonly model: string;
  readonly audio: Uint8Array;
  readonly language?: string;
  readonly prompt?: string;
  readonly responseFormat?: 'json' | 'text' | 'srt' | 'vtt';
  readonly temperature?: number;
};

/** A time-aligned text segment within a transcription. */
export type TranscribeSegment = {
  readonly text: string;
  readonly start: number;
  readonly end: number;
};

/** Result of an audio transcription request. */
export type TranscribeResult = {
  readonly text: string;
  readonly language: string | null;
  readonly duration: number | null;
  readonly segments: readonly TranscribeSegment[] | null;
};

// ---------------------------------------------------------------------------
// Client interface
// ---------------------------------------------------------------------------

/**
 * LLM Router client interface.
 * Organises methods by capability namespace for discoverability.
 */
export type LlmRouterClient = {
  readonly completions: {
    /** Non-streaming chat / text completion. */
    readonly create: (params: CompletionParams) => Promise<CompletionResult>;
    /** Streaming completion; yields NDJSON chunks as `StreamChunk` values. */
    readonly stream: (params: CompletionParams) => AsyncGenerator<StreamChunk, void, unknown>;
  };
  readonly models: {
    /** List model IDs available from a single provider. */
    readonly list: (params: ListProviderModelsParams) => Promise<ListProviderModelsResult>;
    /** List all models across all providers. */
    readonly listAll: () => Promise<ListModelsResult>;
  };
  readonly embeddings: {
    /** Generate embeddings for one or more input strings. */
    readonly create: (params: EmbeddingParams) => Promise<EmbeddingResult>;
  };
  readonly ocr: {
    /** Process a document with OCR (Mistral OCR API). */
    readonly process: (params: OcrParams) => Promise<OcrResult>;
  };
  readonly audio: {
    /** Transcribe audio bytes to text (Groq Whisper API). */
    readonly transcribe: (params: TranscribeParams) => Promise<TranscribeResult>;
  };
};
