/**
 * Measures what a turn actually costs the local model.
 *
 * A tool-calling turn sends the system prompt, the project context, and every
 * tool's JSON schema on every round trip. On CPU-only hardware, prompt
 * processing dominates, so this prints the size of each part and times real
 * calls with different tool-set sizes -- data to size the surface with, rather
 * than a guess.
 */
import fs from "node:fs";
import { callableTools } from "@ai-pm/domain";

const BASE = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "llama3.1:latest";

const log = (line: string) => fs.writeSync(1, `${line}\n`);

/** Rough but consistent: ~4 characters per token for English + JSON. */
const tokens = (text: string) => Math.round(text.length / 4);

function toOllamaTool(tool: { name: string; description: string; parameters: unknown }) {
  return { type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } };
}

async function timeCall(tools: unknown[], label: string): Promise<void> {
  const body = {
    model: MODEL,
    messages: [
      { role: "system", content: "You are a project management agent. Be brief." },
      { role: "user", content: "Create a high priority bug for expired login tokens." },
    ],
    stream: false,
    ...(tools.length > 0 ? { tools } : {}),
    options: { temperature: 0.2 },
  };

  const promptChars = JSON.stringify(body).length;
  const started = Date.now();
  try {
    const res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300_000),
    });
    const json = (await res.json()) as {
      message?: { content?: string; tool_calls?: unknown[] };
      prompt_eval_count?: number;
      eval_count?: number;
    };
    const elapsed = Date.now() - started;
    log(
      `${label.padEnd(22)} tools=${String(tools.length).padStart(2)}  payload=${String(promptChars).padStart(6)} chars ` +
        `(~${tokens(JSON.stringify(body))} tok)  ${String(elapsed).padStart(6)}ms  ` +
        `prompt_tokens=${json.prompt_eval_count ?? "?"} out_tokens=${json.eval_count ?? "?"}  ` +
        `toolCalls=${json.message?.tool_calls?.length ?? 0}`,
    );
  } catch (err) {
    log(`${label.padEnd(22)} tools=${tools.length}  FAILED after ${Date.now() - started}ms: ${String(err)}`);
  }
}

async function main() {
  const all = callableTools().map(toOllamaTool);
  const schemaChars = JSON.stringify(all).length;

  log(`\nModel: ${MODEL}`);
  log(`Callable tools: ${all.length}`);
  log(`Tool schema block: ${schemaChars} chars (~${tokens(JSON.stringify(all))} tokens)`);
  log(
    `Largest schemas: ` +
      all
        .map((t) => ({ name: t.function.name, size: JSON.stringify(t).length }))
        .sort((a, b) => b.size - a.size)
        .slice(0, 5)
        .map((t) => `${t.name}=${t.size}`)
        .join(", "),
  );
  log("");

  await timeCall([], "no tools");
  await timeCall(all.slice(0, 8), "8 tools");
  await timeCall(all.slice(0, 16), "16 tools");
  await timeCall(all, "all tools");
  log("");
}

main().catch((err) => {
  log(`measurement failed: ${String(err)}`);
  process.exit(1);
});
