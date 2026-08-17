import { describe, expect, it } from "vitest";
import { z } from "zod";
import { OllamaProvider } from "../src/ollama-provider.js";
import { AIUnavailableError } from "../src/types.js";

describe("OllamaProvider failure handling", () => {
  it("throws AIUnavailableError (never crashes) when Ollama is unreachable", async () => {
    // Port 1 is a reserved/unassigned TCP port that will refuse the connection immediately.
    const provider = new OllamaProvider({ baseUrl: "http://127.0.0.1:1", timeoutMs: 2000 });

    await expect(provider.chat({ messages: [{ role: "user", content: "hi" }] })).rejects.toBeInstanceOf(
      AIUnavailableError,
    );
  });

  it("throws AIUnavailableError for structured() the same way", async () => {
    const provider = new OllamaProvider({ baseUrl: "http://127.0.0.1:1", timeoutMs: 2000 });
    const schema = z.object({ ok: z.boolean() });

    await expect(
      provider.structured({ messages: [{ role: "user", content: "hi" }], schema }),
    ).rejects.toBeInstanceOf(AIUnavailableError);
  });

  it("throws AIUnavailableError for runAgent() the same way, without ever calling executeTool", async () => {
    const provider = new OllamaProvider({ baseUrl: "http://127.0.0.1:1", timeoutMs: 2000 });
    const executeTool = async () => ({ ok: true });

    await expect(
      provider.runAgent({
        messages: [{ role: "user", content: "hi" }],
        tools: [],
        executeTool,
      }),
    ).rejects.toBeInstanceOf(AIUnavailableError);
  });
});
