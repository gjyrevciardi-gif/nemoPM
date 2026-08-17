import type { ChangeEvent } from "@ai-pm/shared";

type Listener = (event: ChangeEvent) => void;

const listeners = new Set<Listener>();

/** Subscribe to change broadcasts. Returns the unsubscribe function. */
export function subscribeToChanges(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Fan a change out to every open stream. A subscriber that throws (a socket
 * that died between the check and the write, say) must never fail the request
 * that published the change.
 */
export function publishChange(event: ChangeEvent): void {
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch {
      // Ignored on purpose -- see above.
    }
  }
}

/** Number of live subscribers. Exposed for tests and for /health-style reporting. */
export function changeSubscriberCount(): number {
  return listeners.size;
}
