/**
 * StreamProtocolFetcher -- fluent SSE stream consumer using Web API (fetch + ReadableStream).
 *
 * Unlike the agent-hub SDK version (which depends on node-fetch), this
 * implementation uses the standard Web Fetch API so it works in both
 * Node.js 18+ and browser environments.
 */

type EventCallback<T> = (event: T) => void;

/**
 * Fluent wrapper around an SSE response stream.
 *
 * Usage:
 * ```ts
 * const stream = await StreamProtocolFetcher.fetchStream(url, { body: payload });
 * stream
 *   .map((event) => handler.handle(event))
 *   .stop(() => console.log('stream ended'))
 *   .catch((err) => console.error(err));
 * ```
 */
export class StreamProtocolStream<T = unknown> {
  private readonly mapCallbacks: EventCallback<T>[] = [];
  private readonly successCallbacks: EventCallback<void>[] = [];
  private readonly stopCallbacks: EventCallback<void>[] = [];
  private readonly errorCallbacks: EventCallback<Error>[] = [];
  private readonly response: Response;
  private buffer: string = '';
  private isActive: boolean = true;

  constructor(response: Response) {
    this.response = response;
    this.processStream();
  }

  /** Register a callback to process each parsed event. */
  map(callback: EventCallback<T>): this {
    this.mapCallbacks.push(callback);
    return this;
  }

  /** Register a callback for successful completion ([DONE] received). */
  success(callback: EventCallback<void>): this {
    this.successCallbacks.push(callback);
    return this;
  }

  /** Register a callback for when the stream ends (natural or manual close). */
  stop(callback: EventCallback<void>): this {
    this.stopCallbacks.push(callback);
    return this;
  }

  /** Register a callback for stream errors. */
  catch(callback: EventCallback<Error>): this {
    this.errorCallbacks.push(callback);
    return this;
  }

  /** Manually close the stream. */
  close(): void {
    if (this.isActive) {
      this.isActive = false;
      for (const cb of this.stopCallbacks) cb();
    }
  }

  // -------------------------------------------------------------------------
  // Private: stream processing via ReadableStream (Web API)
  // -------------------------------------------------------------------------

  private processStream(): void {
    const { body } = this.response;
    if (body === null) {
      const error = new Error('No response body received');
      for (const cb of this.errorCallbacks) cb(error);
      return;
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();

    const pump = (): void => {
      reader
        .read()
        .then(({ value, done }) => {
          if (!this.isActive) return;

          if (done) {
            this.isActive = false;
            for (const cb of this.stopCallbacks) cb();
            return;
          }

          const text = decoder.decode(value, { stream: true });
          this.buffer += text;

          const parts = this.buffer.split('\n\n');
          this.buffer = parts.pop() ?? '';

          for (const part of parts) {
            if (!this.isActive) break;

            const trimmed = part.trim();
            if (trimmed.length === 0) continue;

            // Skip SSE comments (e.g., `:keepalive`)
            if (trimmed.startsWith(':')) continue;

            // Extract `data:` line from SSE block
            let dataLine: string | undefined;
            for (const line of trimmed.split('\n')) {
              if (line.startsWith('data:')) {
                dataLine = line.slice('data:'.length).trim();
              }
            }

            if (dataLine === undefined) {
              // Try parsing the raw block as JSON (non-SSE format)
              try {
                const parsed = JSON.parse(trimmed) as T;
                for (const cb of this.mapCallbacks) cb(parsed);
              } catch {
                // Not JSON -- skip silently
              }
              continue;
            }

            // [DONE] sentinel -- stream complete
            if (dataLine === '[DONE]') {
              for (const cb of this.successCallbacks) cb();
              continue;
            }

            try {
              const parsed = JSON.parse(dataLine) as T;
              for (const cb of this.mapCallbacks) cb(parsed);
            } catch {
              // Malformed JSON line -- skip
            }
          }

          pump();
        })
        .catch((err: unknown) => {
          if (this.isActive) {
            this.isActive = false;
            const error = err instanceof Error ? err : new Error(String(err));
            for (const cb of this.errorCallbacks) cb(error);
          }
        });
    };

    pump();
  }
}

// ---------------------------------------------------------------------------
// Static factory
// ---------------------------------------------------------------------------

export const StreamProtocolFetcher = {
  /**
   * Opens an SSE stream to the given URL and returns a `StreamProtocolStream`
   * for fluent event processing.
   */
  async fetchStream<T = unknown>(
    url: string,
    options: {
      readonly method?: string;
      readonly headers?: Readonly<Record<string, string>>;
      readonly body?: string | object;
      readonly signal?: AbortSignal;
    } = {}
  ): Promise<StreamProtocolStream<T>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(options.headers ?? {}),
    };

    let body: string | undefined;
    if (options.body !== undefined) {
      body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    }

    const response = await fetch(url, {
      method: options.method ?? 'POST',
      headers,
      body,
      signal: options.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
    }

    return new StreamProtocolStream<T>(response);
  },
} as const;
