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
import { callableTools, routeAgentTools } from "@ai-pm/domain";
import { AGENT_SYSTEM_PROMPT } from "../src/lib/ai.js";

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

  const sampleContext = `<project_data>\nProject: Example (EX)\nProgress: 12/30 issues\nIssues (bounded): ...\n</project_data>`;
  const routes = [
    ["issue_create", "Create a high-priority bug for expired login tokens."],
    ["issue_update", "Change EX-12 to critical priority."],
    ["sprint_planning", "Plan the next sprint with max 24 points and avoid blocked work."],
    ["memory", "Why did we choose SQLite?"],
    ["code_context", "Create a bug for this selected code."],
    ["safe_fallback", "Help me understand the project."],
  ] as const;
  log("ROUTED SURFACES");
  for (const [label,message] of routes) {
    const route=routeAgentTools(message,{hasCodeContext:label==="code_context"});
    const serialized=JSON.stringify(route.tools.map(toOllamaTool));
    const total=AGENT_SYSTEM_PROMPT.length+sampleContext.length+message.length+serialized.length;
    log(`${label.padEnd(18)} intent=${route.primary.padEnd(17)} tools=${String(route.tools.length).padStart(2)} schema=~${String(tokens(serialized)).padStart(4)} tok system=~${tokens(AGENT_SYSTEM_PROMPT)} context=~${tokens(sampleContext)} total=~${tokens("x".repeat(total))} tok`);
  }
  log(`full_registry      tools=${String(all.length).padStart(2)} schema=~${tokens(JSON.stringify(all))} tok`);
  log("");

  if (process.argv.includes("--live")) {
    await timeCall([], "no tools");
    await timeCall(routeAgentTools("Create a high priority bug for expired login tokens").tools.map(toOllamaTool), "routed create");
    await timeCall(all, "all tools");
  } else log("Pass --live to benchmark the configured Ollama model.");
  log("");
}

main().catch((err) => {
  log(`measurement failed: ${String(err)}`);
  process.exit(1);
});
