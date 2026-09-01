"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUIStore } from "@/store/ui-store";

/**
 * Subscribe to the server's SSE stream for the current engagement and refetch
 * affected queries when something changes elsewhere (another user/tab). Returns
 * the live-connection state for a status indicator.
 */
export function useLiveUpdates(): { connected: boolean } {
  const engagementId = useUIStore((s) => s.engagementId);
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("EventSource" in window)) return;

    const params = new URLSearchParams();
    if (engagementId) params.set("engagementId", engagementId);
    const source = new EventSource(`/api/stream?${params.toString()}`);

    const invalidateAnomalies = () => {
      void queryClient.invalidateQueries({ queryKey: ["anomalies"] });
      void queryClient.invalidateQueries({ queryKey: ["anomalies-summary"] });
    };

    source.addEventListener("ready", () => setConnected(true));
    source.addEventListener("anomaly.updated", invalidateAnomalies);
    source.addEventListener("anomaly.created", invalidateAnomalies);
    source.addEventListener("document.created", () => {
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
    });
    source.onerror = () => setConnected(false);

    return () => {
      source.close();
      setConnected(false);
    };
  }, [engagementId, queryClient]);

  return { connected };
}
