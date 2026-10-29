import { describe, expect, it } from "vitest";
import { z } from "zod";
import { GeminiProvider } from "../src/gemini-provider.js";
import { AIUnavailableError } from "../src/types.js";

describe("GeminiProvider failure handling", () => {
  it("throws AIUnavailableError (never crashes) when no API key is set", async () => {
    const provider = new GeminiProvider({ apiKey: undefined });

    await expect(provider.chat({ messages: [{ role: "user", content: "hi" }] })).rejects.toBeInstanceOf(
      AIUnavailableError,
    );
  });

  it("throws AIUnavailableError for structured() the same way", async () => {
    const provider = new GeminiProvider({ apiKey: undefined });
    const schema = z.object({ ok: z.boolean() });

    await expect(
      provider.structured({ messages: [{ role: "user", content: "hi" }], schema }),
    ).rejects.toBeInstanceOf(AIUnavailableError);
  });

  it("throws AIUnavailableError for runAgent() the same way, without ever calling executeTool", async () => {
    const provider = new GeminiProvider({ apiKey: undefined });
    const executeTool = async () => ({ ok: true });

    await expect(
      provider.runAgent({
        messages: [{ role: "user", content: "hi" }],
        tools: [],
        executeTool,
      }),
    ).rejects.toBeInstanceOf(AIUnavailableError);
  });

  it("throws AIUnavailableError when the host is unreachable", async () => {
    // Port 1 is a reserved/unassigned TCP port that will refuse the connection immediately.
    const provider = new GeminiProvider({ apiKey: "test-key", baseUrl: "http://127.0.0.1:1", timeoutMs: 2000 });

    await expect(provider.chat({ messages: [{ role: "user", content: "hi" }] })).rejects.toBeInstanceOf(
      AIUnavailableError,
    );
  });

  it("reports offline health without an API key", async () => {
    const provider = new GeminiProvider({ apiKey: undefined });
    const health = await provider.health();
    expect(health.state).toBe("offline");
    expect(health.reachable).toBe(false);
  });
});
