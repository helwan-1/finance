import type { NextRequest } from "next/server";
import { subscribeAuditEvents, type AuditEvent } from "@/lib/events";
import { authorize } from "@/lib/auth/guard";

// Long-lived streaming response: Node runtime, never statically optimized.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/stream?engagementId=... — Server-Sent Events for live dashboard
 * updates. Emits an event whenever an anomaly in the engagement changes, so
 * connected clients can refetch. Guarded like any data route (auth cookie is
 * sent automatically by EventSource on same-origin requests).
 */
export async function GET(request: NextRequest): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const engagementId = searchParams.get("engagementId") ?? "";

  const authz = await authorize("anomalies:view", engagementId || undefined);
  if (!authz.ok) return authz.response;

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      // Initial hello so the client knows the stream is live.
      send("ready", { engagementId, at: new Date().toISOString() });

      unsubscribe = subscribeAuditEvents(engagementId, (e: AuditEvent) => {
        send(e.type, e);
      });

      // Comment heartbeats keep proxies from closing an idle connection.
      heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(`: ping\n\n`));
      }, 25000);
    },
    cancel() {
      if (unsubscribe) unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  // If the client disconnects, tear down the subscription.
  request.signal.addEventListener("abort", () => {
    if (unsubscribe) unsubscribe();
    if (heartbeat) clearInterval(heartbeat);
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
