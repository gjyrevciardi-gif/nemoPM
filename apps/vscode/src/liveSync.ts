import * as vscode from "vscode";
import type { ChangeEvent } from "@ai-pm/shared";
import { baseUrl } from "./api.js";

const FIRST_RETRY_MS = 1_000;
const MAX_RETRY_MS = 15_000;

/**
 * Holds an SSE connection to the API's /events stream so this window sees
 * changes made anywhere else -- the web app, another editor window, the agent
 * -- the moment they happen.
 *
 * The extension host has `fetch` but no `EventSource`, so the stream is read
 * and framed by hand. Reconnects with backoff, because `pnpm dev` restarts the
 * API on every save and the connection is expected to drop.
 */
export class LiveSync implements vscode.Disposable {
  private controller: AbortController | undefined;
  private retryTimer: NodeJS.Timeout | undefined;
  private retryDelay = FIRST_RETRY_MS;
  private disposed = false;

  constructor(private readonly onChange: (event: ChangeEvent) => void) {}

  start(): void {
    void this.connect();
  }

  dispose(): void {
    this.disposed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.controller?.abort();
  }

  private async connect(): Promise<void> {
    if (this.disposed) return;

    const controller = new AbortController();
    this.controller = controller;
    try {
      const res = await fetch(`${baseUrl()}/events`, {
        headers: { Accept: "text/event-stream" },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`/events responded ${res.status}`);

      // Connected: the next drop should retry quickly again.
      this.retryDelay = FIRST_RETRY_MS;
      await this.readStream(res.body);
    } catch {
      // Server down, restarting, or aborted on dispose -- all handled the same.
    }
    this.scheduleReconnect();
  }

  private async readStream(body: NonNullable<Response["body"]>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });

      // Frames are separated by a blank line; anything before the last one is
      // complete and safe to hand over.
      let split = buffer.indexOf("\n\n");
      while (split !== -1) {
        this.handleFrame(buffer.slice(0, split));
        buffer = buffer.slice(split + 2);
        split = buffer.indexOf("\n\n");
      }
    }
  }

  private handleFrame(frame: string): void {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!data) return; // Heartbeat comment or a `retry:` directive.

    try {
      this.onChange(JSON.parse(data) as ChangeEvent);
    } catch {
      // A malformed frame isn't worth tearing the connection down for.
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;
    const delay = this.retryDelay;
    this.retryDelay = Math.min(delay * 2, MAX_RETRY_MS);
    this.retryTimer = setTimeout(() => void this.connect(), delay);
  }
}
