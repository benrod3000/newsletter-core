/**
 * EventBus — lightweight in-memory pub/sub for domain events.
 *
 * No external dependencies. Events are synchronous (each handler
 * runs before the next). Fire-and-forget — handler errors never
 * propagate to the caller.
 *
 * Future: replace with a persistent event store for replay capability.
 */

export interface DomainEvent {
  type: string;
  timestamp: number;
  campaignId?: string;
  workspaceId?: string;
  subscriberId?: string;
  data: Record<string, unknown>;
}

type EventHandler = (event: DomainEvent) => void | Promise<void>;

class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();

  /** Subscribe to an event type. Returns an unsubscribe function. */
  on(eventType: string, handler: EventHandler): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);
    return () => this.handlers.get(eventType)?.delete(handler);
  }

  /** Emit an event. All matching handlers run synchronously. Errors are caught per-handler. */
  emit(event: DomainEvent): void {
    const handlers = this.handlers.get(event.type);
    if (!handlers?.size) return;
    for (const handler of handlers) {
      try {
        handler(event);
      } catch (err) {
        console.error(`[events] Handler for "${event.type}" threw:`, err);
      }
    }
  }
}

/** Singleton event bus */
export const bus = new EventBus();
