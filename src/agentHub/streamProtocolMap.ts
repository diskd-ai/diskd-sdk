/**
 * Protocol event map for Agent Hub streaming protocol.
 * Defines all event types based on the agent-hub STREAMING_PROTO.md specification.
 *
 * These are pure data types only -- no classes, no I/O, no side effects.
 */

type ContentPartType = 'output_text' | 'image' | 'file' | 'audio';

// -- Response lifecycle events ------------------------------------------------

export type ResponseCreatedEvent = {
  readonly type: 'response.created';
  readonly response: {
    readonly id: string;
    readonly object: string;
    readonly created_at: number;
    readonly status: string;
    readonly model: string;
    readonly output: readonly unknown[];
    readonly temperature: number;
    readonly top_p: number;
    readonly metadata: Readonly<Record<string, unknown>>;
  };
};

export type ResponseInProgressEvent = {
  readonly type: 'response.in_progress';
  readonly response: {
    readonly id: string;
    readonly object: string;
    readonly created_at: number;
    readonly status: string;
    readonly model: string;
    readonly output: readonly unknown[];
    readonly temperature: number;
    readonly top_p: number;
    readonly metadata: Readonly<Record<string, unknown>>;
  };
};

export type ResponseCompletedEvent = {
  readonly type: 'response.completed';
  readonly response: {
    readonly id: string;
    readonly object: string;
    readonly created_at: number;
    readonly status: 'completed';
    readonly model: string;
    readonly output: readonly {
      readonly id: string;
      readonly type: string;
      readonly role: string;
      readonly status: string;
      readonly content: readonly {
        readonly type: string;
        readonly text: string;
        readonly annotations: readonly unknown[];
      }[];
    }[];
    readonly temperature: number;
    readonly top_p: number;
    readonly usage: {
      readonly input_tokens: number;
      readonly output_tokens: number;
      readonly total_tokens: number;
      readonly output_tokens_details?: {
        readonly reasoning_tokens: number;
      };
    } | null;
    readonly metadata: Readonly<Record<string, unknown>>;
  };
};

export type ResponseFailedEvent = {
  readonly type: 'response.failed';
  readonly response: {
    readonly id: string;
    readonly object: string;
    readonly created_at: number;
    readonly status: 'failed';
    readonly error: {
      readonly code: string;
      readonly message: string;
    };
    readonly model: string;
    readonly output: readonly unknown[];
    readonly metadata: Readonly<Record<string, unknown>>;
  };
};

export type ResponseIncompleteEvent = {
  readonly type: 'response.incomplete';
  readonly response: {
    readonly id: string;
    readonly object: string;
    readonly created_at: number;
    readonly status: 'incomplete';
    readonly incomplete_details: {
      readonly reason: string;
    };
    readonly model: string;
    readonly output: readonly unknown[];
    readonly metadata: Readonly<Record<string, unknown>>;
  };
};

// -- Output item events -------------------------------------------------------

export type OutputItemAddedEvent = {
  readonly type: 'response.output_item.added';
  readonly output_index: number;
  readonly item: {
    readonly id: string;
    readonly status: 'in_progress';
    readonly type: string;
    readonly role: string;
    readonly content: readonly unknown[];
  };
};

export type OutputItemDoneEvent = {
  readonly type: 'response.output_item.done';
  readonly output_index: number;
  readonly item: {
    readonly id: string;
    readonly status: 'completed';
    readonly type: string;
    readonly role: string;
    readonly content: readonly {
      readonly type: string;
      readonly text: string;
      readonly annotations: readonly unknown[];
    }[];
  };
};

// -- Content part events ------------------------------------------------------

export type ContentPartAddedEvent = {
  readonly type: 'response.content_part.added';
  readonly item_id: string;
  readonly output_index: number;
  readonly content_index: number;
  readonly part: {
    readonly type: ContentPartType;
    readonly text?: string;
    readonly image?: { readonly data: string; readonly mimeType: string };
    readonly file?: { readonly data: string; readonly filename: string; readonly mimeType: string };
    readonly annotations: readonly unknown[];
  };
};

export type ContentPartDoneEvent = {
  readonly type: 'response.content_part.done';
  readonly item_id: string;
  readonly output_index: number;
  readonly content_index: number;
  readonly part: {
    readonly type: ContentPartType;
    readonly text?: string;
    readonly image?: { readonly data: string; readonly mimeType: string };
    readonly file?: { readonly data: string; readonly filename: string; readonly mimeType: string };
    readonly annotations: readonly unknown[];
  };
};

// -- Text output events -------------------------------------------------------

export type TextOutputDeltaEvent = {
  readonly type: 'response.output_text.delta';
  readonly item_id: string;
  readonly output_index: number;
  readonly content_index: number;
  readonly delta: string;
};

export type TextOutputDoneEvent = {
  readonly type: 'response.output_text.done';
  readonly item_id: string;
  readonly output_index: number;
  readonly content_index: number;
  readonly text: string;
};

export type TextOutputAnnotationAddedEvent = {
  readonly type: 'response.output_text.annotation.added';
  readonly item_id: string;
  readonly output_index: number;
  readonly content_index: number;
  readonly annotation_index: number;
  readonly annotation: {
    readonly type: string;
    readonly index: number;
    readonly file_id?: string;
    readonly filename?: string;
    readonly [key: string]: unknown;
  };
};

// -- Refusal events -----------------------------------------------------------

export type RefusalDeltaEvent = {
  readonly type: 'response.refusal.delta';
  readonly item_id: string;
  readonly output_index: number;
  readonly content_index: number;
  readonly delta: string;
};

export type RefusalDoneEvent = {
  readonly type: 'response.refusal.done';
  readonly item_id: string;
  readonly output_index: number;
  readonly content_index: number;
  readonly refusal: string;
};

// -- Function call events -----------------------------------------------------

export type FunctionCallArgumentsDeltaEvent = {
  readonly type: 'response.function_call_arguments.delta';
  readonly functionName: string;
  readonly item_id: string;
  readonly output_index: number;
  readonly delta: string;
};

export type FunctionCallArgumentsDoneEvent = {
  readonly type: 'response.function_call_arguments.done';
  readonly functionName: string;
  readonly item_id: string;
  readonly output_index: number;
  readonly arguments: string;
};

export type FunctionCallResultEvent = {
  readonly type: 'response.function_call.result';
  readonly functionName: string;
  readonly item_id: string;
  readonly output_index: number;
  readonly result: unknown;
};

// -- External sources ---------------------------------------------------------

export type EventExternalSourceItem = {
  readonly uuid: string;
  readonly origin_uri: string;
  readonly origin_title: string;
  readonly document_id: string;
  readonly content: string;
  readonly score: number;
  readonly metadata: Readonly<Record<string, unknown>>;
};

export type ExternalSourcesAddedEvent = {
  readonly type: 'response.external_sources.added';
  readonly sources: readonly EventExternalSourceItem[];
};

// -- Plan / update events -----------------------------------------------------

export type UpdatePlanEvent = {
  readonly type: 'response.update_plan';
  readonly task: string;
};

// -- Search events ------------------------------------------------------------

export type FileSearchCallInProgressEvent = {
  readonly type: 'response.file_search_call.in_progress';
  readonly output_index: number;
  readonly item_id: string;
};

export type FileSearchCallSearchingEvent = {
  readonly type: 'response.file_search_call.searching';
  readonly output_index: number;
  readonly item_id: string;
};

export type FileSearchCallCompletedEvent = {
  readonly type: 'response.file_search_call.completed';
  readonly output_index: number;
  readonly item_id: string;
};

export type WebSearchCallInProgressEvent = {
  readonly type: 'response.web_search_call.in_progress';
  readonly output_index: number;
  readonly item_id: string;
};

export type WebSearchCallSearchingEvent = {
  readonly type: 'response.web_search_call.searching';
  readonly output_index: number;
  readonly item_id: string;
};

export type WebSearchCallCompletedEvent = {
  readonly type: 'response.web_search_call.completed';
  readonly output_index: number;
  readonly item_id: string;
};

// -- Session events -----------------------------------------------------------

export type SessionUpdateEvent = {
  readonly type: 'session.update';
  readonly sessionId: string;
};

// -- Error event --------------------------------------------------------------

export type StreamProtocolErrorEvent = {
  readonly type: 'error';
  readonly code: string;
  readonly message: string;
  readonly param: null;
};

// -- Notification event -------------------------------------------------------

export type NotificationEvent = {
  readonly type: 'response.notification';
  readonly notification: {
    readonly method: string;
    readonly params: {
      readonly level: 'info' | 'debug' | 'warning' | 'error';
      readonly data: string;
    };
  };
};

// -- Protocol event map -------------------------------------------------------

export type StreamProtocolMap = {
  readonly 'response.created': (event: ResponseCreatedEvent) => void;
  readonly 'response.in_progress': (event: ResponseInProgressEvent) => void;
  readonly 'response.completed': (event: ResponseCompletedEvent) => void;
  readonly 'response.failed': (event: ResponseFailedEvent) => void;
  readonly 'response.incomplete': (event: ResponseIncompleteEvent) => void;

  readonly 'response.output_item.added': (event: OutputItemAddedEvent) => void;
  readonly 'response.output_item.done': (event: OutputItemDoneEvent) => void;

  readonly 'response.content_part.added': (event: ContentPartAddedEvent) => void;
  readonly 'response.content_part.done': (event: ContentPartDoneEvent) => void;

  readonly 'response.output_text.delta': (event: TextOutputDeltaEvent) => void;
  readonly 'response.output_text.done': (event: TextOutputDoneEvent) => void;
  readonly 'response.output_text.annotation.added': (event: TextOutputAnnotationAddedEvent) => void;

  readonly 'response.refusal.delta': (event: RefusalDeltaEvent) => void;
  readonly 'response.refusal.done': (event: RefusalDoneEvent) => void;

  readonly 'response.function_call_arguments.delta': (
    event: FunctionCallArgumentsDeltaEvent
  ) => void;
  readonly 'response.function_call_arguments.done': (event: FunctionCallArgumentsDoneEvent) => void;
  readonly 'response.function_call.result': (event: FunctionCallResultEvent) => void;

  readonly 'response.external_sources.added': (event: ExternalSourcesAddedEvent) => void;
  readonly 'response.update_plan': (event: UpdatePlanEvent) => void;

  readonly 'response.file_search_call.in_progress': (event: FileSearchCallInProgressEvent) => void;
  readonly 'response.file_search_call.searching': (event: FileSearchCallSearchingEvent) => void;
  readonly 'response.file_search_call.completed': (event: FileSearchCallCompletedEvent) => void;

  readonly 'response.web_search_call.in_progress': (event: WebSearchCallInProgressEvent) => void;
  readonly 'response.web_search_call.searching': (event: WebSearchCallSearchingEvent) => void;
  readonly 'response.web_search_call.completed': (event: WebSearchCallCompletedEvent) => void;

  readonly 'session.update': (event: SessionUpdateEvent) => void;

  readonly 'response.notification': (event: NotificationEvent) => void;
  readonly error: (event: StreamProtocolErrorEvent) => void;

  readonly string: (event: string) => void;
  readonly content: (event: unknown) => void;
};
