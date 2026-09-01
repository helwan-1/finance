import { EventEmitter } from "node:events";

/**
 * In-process pub/sub for live dashboard updates (SSE).
 *
 * Events are scoped by engagement. A single Node process shares one emitter
 * (persisted on globalThis so it survives dev HMR). For a multi-instance
 * deployment this would be backed by Redis pub/sub or a message broker — the
 * publish/subscribe surface below is the seam for that.
 */

export type AuditEventType =
  | "anomaly.updated"
  | "anomaly.created"
  | "document.created";

export interface AuditEvent {
  type: AuditEventType;
  engagementId: string;
  /** Small, non-sensitive payload (ids / status) for the client to react to. */
  payload?: Record<string, unknown>;
  at: string;
}

const globalForEvents = globalThis as unknown as {
  auditEmitter: EventEmitter | undefined;
};

const emitter =
  globalForEvents.auditEmitter ??
  (() => {
    const e = new EventEmitter();
    e.setMaxListeners(0); // unbounded — one listener per open SSE connection
    return e;
  })();

if (process.env.NODE_ENV !== "production") {
  globalForEvents.auditEmitter = emitter;
}

/** Channel name for an engagement (empty → a shared demo channel). */
function channel(engagementId: string): string {
  return `engagement:${engagementId || "demo"}`;
}

/** Publish an event to all subscribers of its engagement. */
export function publishAuditEvent(
  event: Omit<AuditEvent, "at">,
): void {
  const full: AuditEvent = { ...event, at: new Date().toISOString() };
  emitter.emit(channel(event.engagementId), full);
}

/** Subscribe to an engagement's events; returns an unsubscribe function. */
export function subscribeAuditEvents(
  engagementId: string,
  listener: (event: AuditEvent) => void,
): () => void {
  const name = channel(engagementId);
  emitter.on(name, listener);
  return () => emitter.off(name, listener);
}
