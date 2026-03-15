/**
 * StreamProtocolFetcher -- fluent SSE stream consumer using Web API (fetch + ReadableStream).
 *
 * Unlike the agent-hub SDK version (which depends on node-fetch), this
 * implementation uses the standard Web Fetch API so it works in both
 * Node.js 18+ and browser environments.
 */
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
export class StreamProtocolStream {
    mapCallbacks = [];
    successCallbacks = [];
    stopCallbacks = [];
    errorCallbacks = [];
    response;
    buffer = '';
    isActive = true;
    constructor(response) {
        this.response = response;
        this.processStream();
    }
    /** Register a callback to process each parsed event. */
    map(callback) {
        this.mapCallbacks.push(callback);
        return this;
    }
    /** Register a callback for successful completion ([DONE] received). */
    success(callback) {
        this.successCallbacks.push(callback);
        return this;
    }
    /** Register a callback for when the stream ends (natural or manual close). */
    stop(callback) {
        this.stopCallbacks.push(callback);
        return this;
    }
    /** Register a callback for stream errors. */
    catch(callback) {
        this.errorCallbacks.push(callback);
        return this;
    }
    /** Manually close the stream. */
    close() {
        if (this.isActive) {
            this.isActive = false;
            for (const cb of this.stopCallbacks)
                cb();
        }
    }
    // -------------------------------------------------------------------------
    // Private: stream processing via ReadableStream (Web API)
    // -------------------------------------------------------------------------
    processStream() {
        const { body } = this.response;
        if (body === null) {
            const error = new Error('No response body received');
            for (const cb of this.errorCallbacks)
                cb(error);
            return;
        }
        const reader = body.getReader();
        const decoder = new TextDecoder();
        const pump = () => {
            reader
                .read()
                .then(({ value, done }) => {
                if (!this.isActive)
                    return;
                if (done) {
                    this.isActive = false;
                    for (const cb of this.stopCallbacks)
                        cb();
                    return;
                }
                const text = decoder.decode(value, { stream: true });
                this.buffer += text;
                const parts = this.buffer.split('\n\n');
                this.buffer = parts.pop() ?? '';
                for (const part of parts) {
                    if (!this.isActive)
                        break;
                    const trimmed = part.trim();
                    if (trimmed.length === 0)
                        continue;
                    // Skip SSE comments (e.g., `:keepalive`)
                    if (trimmed.startsWith(':'))
                        continue;
                    // Extract `data:` line from SSE block
                    let dataLine;
                    for (const line of trimmed.split('\n')) {
                        if (line.startsWith('data:')) {
                            dataLine = line.slice('data:'.length).trim();
                        }
                    }
                    if (dataLine === undefined) {
                        // Try parsing the raw block as JSON (non-SSE format)
                        try {
                            const parsed = JSON.parse(trimmed);
                            for (const cb of this.mapCallbacks)
                                cb(parsed);
                        }
                        catch {
                            // Not JSON -- skip silently
                        }
                        continue;
                    }
                    // [DONE] sentinel -- stream complete
                    if (dataLine === '[DONE]') {
                        for (const cb of this.successCallbacks)
                            cb();
                        continue;
                    }
                    try {
                        const parsed = JSON.parse(dataLine);
                        for (const cb of this.mapCallbacks)
                            cb(parsed);
                    }
                    catch {
                        // Malformed JSON line -- skip
                    }
                }
                pump();
            })
                .catch((err) => {
                if (this.isActive) {
                    this.isActive = false;
                    const error = err instanceof Error ? err : new Error(String(err));
                    for (const cb of this.errorCallbacks)
                        cb(error);
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
    async fetchStream(url, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            ...(options.headers ?? {}),
        };
        let body;
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
        return new StreamProtocolStream(response);
    },
};
