import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ChangeEvent } from "@ai-pm/shared";
import { API_BASE } from "./api.js";

export type LiveStatus = "connecting" | "live" | "offline";

/**
 * Keeps this tab in step with every other surface. Anything that writes --
 * another tab, the VS Code extension, the agent running its own tools --
 * lands as a change event on the API's SSE stream, and we refetch.
 *
 * Call this once, at the app root: one stream per tab.
 */
export function useLiveSync(): LiveStatus {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>("connecting");

  useEffect(() => {
    const source = new EventSource(`${API_BASE}/events`);

    source.onopen = () => setStatus("live");
    // EventSource retries on its own; the status is only here so the UI can
    // admit when what it's showing might be stale.
    source.onerror = () => setStatus("offline");

    source.addEventListener("change", (message) => {
      setStatus("live");
      // Coarse on purpose. This is a single-user local app with little data,
      // so refetching what's on screen costs less than a map from every API
      // route to the query keys it happens to touch -- a map that would rot
      // the first time a route changed.
      void queryClient.invalidateQueries();

      if (import.meta.env.DEV) {
        try {
          const event = JSON.parse((message as MessageEvent).data) as ChangeEvent;
          console.debug(`[live] ${event.method} ${event.path}`);
        } catch {
          // A malformed frame is not worth breaking the refresh over.
        }
      }
    });

    return () => source.close();
  }, [queryClient]);

  return status;
}
