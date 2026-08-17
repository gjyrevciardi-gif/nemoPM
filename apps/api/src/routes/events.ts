import type { FastifyInstance } from "fastify";
import { subscribeToChanges } from "../lib/events.js";

/**
 * Server-sent events: the one place clients learn that data moved.
 *
 * SSE rather than websockets because the traffic is one-way and a browser's
 * EventSource reconnects on its own -- which matters here, since `pnpm dev`
 * restarts the API every time a file is saved.
 */
const HEARTBEAT_MS = 25_000;

export async function eventRoutes(app: FastifyInstance) {
  // Streams have to be closed by hand when the server shuts down, otherwise a
  // dev-server restart hangs waiting for connections that never end.
  const openStreams = new Set<() => void>();

  app.addHook("onClose", async () => {
    for (const close of [...openStreams]) close();
  });

  app.get("/events", (req, reply) => {
    // Fastify must not manage this response -- we own the socket from here.
    reply.hijack();

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Written by hand because @fastify/cors sets its headers through the
      // reply object, which a hijacked response never consults. The web app
      // runs on a different localhost port, so it needs this.
      "Access-Control-Allow-Origin": req.headers.origin ?? "*",
    });
    // Come back fast after an API restart instead of EventSource's 3s default.
    reply.raw.write("retry: 1000\n\n");

    const unsubscribe = subscribeToChanges((event) => {
      reply.raw.write(`event: change\ndata: ${JSON.stringify(event)}\n\n`);
    });

    // Comment frames: keep the connection warm and let a client notice a dead
    // stream even when nothing is changing.
    const heartbeat = setInterval(() => reply.raw.write(": ping\n\n"), HEARTBEAT_MS);
    heartbeat.unref();

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      openStreams.delete(close);
      reply.raw.end();
    };

    openStreams.add(close);
    req.raw.on("close", close);
    req.raw.on("error", close);
  });
}
