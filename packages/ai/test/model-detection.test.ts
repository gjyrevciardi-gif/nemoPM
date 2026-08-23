import { afterEach, describe, expect, it, vi } from "vitest";
import { OllamaProvider } from "../src/ollama-provider.js";
import { AIUnavailableError } from "../src/types.js";

type Tag = { name: string; capabilities?: string[] };

/** Answers /api/tags with the given install, and echoes the model back from /api/chat. */
function stubOllama(models: Tag[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        String(url).includes("/api/tags")
          ? { models }
          : { model: "echo", message: { role: "assistant", content: "ok" } },
    })),
  );
}

describe("choosing a local model automatically", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("skips models that cannot call tools", async () => {
    stubOllama([
      { name: "nomic-embed-text:latest", capabilities: ["embedding"] },
      { name: "qwen2.5:3b", capabilities: ["completion", "tools"] },
    ]);

    const provider = new OllamaProvider();
    const result = await provider.chat({ messages: [{ role: "user", content: "hi" }] });

    expect(result.text).toBe("ok");
    const body = JSON.parse((vi.mocked(fetch).mock.calls.at(-1)![1] as { body: string }).body);
    expect(body.model).toBe("qwen2.5:3b");
  });

  it("explains itself when nothing installed can call tools", async () => {
    stubOllama([{ name: "nomic-embed-text:latest", capabilities: ["embedding"] }]);

    await expect(new OllamaProvider().chat({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(
      /support tool calling/i,
    );
  });

  it("still works against an Ollama that does not report capabilities", async () => {
    stubOllama([{ name: "llama3.1:latest" }]);

    await expect(new OllamaProvider().chat({ messages: [{ role: "user", content: "hi" }] })).resolves.toMatchObject({
      text: "ok",
    });
  });

  it("says so when no model is installed at all", async () => {
    stubOllama([]);

    await expect(
      new OllamaProvider().chat({ messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toBeInstanceOf(AIUnavailableError);
  });
});
