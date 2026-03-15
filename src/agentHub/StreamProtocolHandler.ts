import type { StreamProtocolMap } from './streamProtocolMap.js';

type HandlerStore = {
  [K in keyof StreamProtocolMap]?: StreamProtocolMap[K];
};

/**
 * Strongly-typed fluent API for routing stream protocol events to handlers.
 *
 * Usage:
 * ```ts
 * const handler = new StreamProtocolHandler()
 *   .on('response.output_text.delta', (event) => process.stdout.write(event.delta))
 *   .on('response.completed', (event) => console.log('done', event.response.usage))
 *   .on('error', (event) => console.error(event.message));
 * ```
 */
export class StreamProtocolHandler {
  private readonly handlers: HandlerStore = {};

  on<K extends keyof StreamProtocolMap>(type: K, handler: StreamProtocolMap[K]): this {
    this.handlers[type] = handler;
    return this;
  }

  handle(event: unknown): void {
    if (!event) return;

    // Handle raw string events
    if (typeof event === 'string') {
      const h = this.handlers.string;
      if (h) (h as (e: string) => void)(event);
      return;
    }

    if (typeof event !== 'object') return;

    const eventObj = event as Record<string, unknown>;

    // Handle OpenAI-compatible streaming format (choices[0].delta.content)
    if ('choices' in eventObj && Array.isArray(eventObj.choices)) {
      const choices = eventObj.choices as readonly { delta?: { content?: string } }[];
      const delta = choices[0]?.delta;
      if (delta?.content && this.handlers['response.output_text.delta']) {
        (
          this.handlers['response.output_text.delta'] as (e: {
            type: string;
            delta: string;
          }) => void
        )({
          type: 'response.output_text.delta',
          delta: delta.content,
        });
        return;
      }
    }

    // Direct event type dispatch
    if ('type' in eventObj && typeof eventObj.type === 'string') {
      const eventType = eventObj.type as keyof StreamProtocolMap;
      const h = this.handlers[eventType];
      if (h) {
        (h as (e: unknown) => void)(event);
        return;
      }
    }

    // Fallback: content without specific type
    if (!('type' in eventObj) && 'content' in eventObj && this.handlers.content) {
      (this.handlers.content as (e: unknown) => void)(event);
      return;
    }

    // Generic content fallback
    if (this.handlers.content) {
      (this.handlers.content as (e: unknown) => void)(event);
    }
  }
}
