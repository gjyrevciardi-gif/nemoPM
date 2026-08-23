import { ROUTING_EVAL_CASES } from "./eval-routing.js";

const model = process.env.OLLAMA_MODEL ?? "llama3.2:1b";
const bootstrap = ROUTING_EVAL_CASES.filter((c) => c.mode === "BOOTSTRAP").filter((_,i)=>i%6===0).slice(0,10);
const nonBootstrap = ROUTING_EVAL_CASES.filter((c) => c.mode !== "BOOTSTRAP").filter((_,i)=>i%10===0).slice(0,10);
const cases = [...bootstrap,...nonBootstrap];
const started = performance.now();
const format = { type: "object", properties: { results: { type: "array", items: { type: "object", properties: { id: { type: "integer" }, projectMode: { type: "string", enum: ["BOOTSTRAP", "ACTIVE", "IMPORTED", "MAINTENANCE", "COMPLETED"] }, intent: { type: "string" }, capabilities: { type: "array", items: { type: "string" } }, mutationIntent: { type: "string", enum: ["none", "auto", "ask", "blocked"] } }, required: ["id", "projectMode", "intent", "capabilities", "mutationIntent"] } } }, required: ["results"] };
const response = await fetch("http://127.0.0.1:11434/api/chat", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ model, stream: false, format, messages: [
    { role: "system", content: "You are NEMO Router. Classify each independent request. Return only schema JSON. Stable intents: bootstrap.define_product, bootstrap.define_mvp, bootstrap.architecture, bootstrap.create_epics, bootstrap.create_backlog, bootstrap.plan_first_sprint, issue.create, issue.update, issue.breakdown, sprint.plan, sprint.review, sprint.complete, project.status, project.risk, project.next_actions, code.explain_work, memory.record, memory.query, portfolio.analyze. New projects without Git are BOOTSTRAP." },
    { role: "user", content: JSON.stringify(cases.map((c, id) => ({ id, message: c.message, state: { explicitProjectMode: c.mode, repositoryConnected: c.mode !== "BOOTSTRAP", activeSprint: c.mode === "ACTIVE" } }))) },
  ], options: { temperature: 0, num_predict: 1024 } }),
});
if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
const raw = await response.json() as any;
const parsed = JSON.parse(raw.message.content) as { results: any[] };
const byId = new Map(parsed.results.map((r) => [r.id, r]));
let modeCorrect = 0, intentCorrect = 0, capabilityCorrect = 0, unsafe = 0;
for (let id = 0; id < cases.length; id++) { const expected = cases[id]!, actual = byId.get(id); if (actual?.projectMode === expected.mode) modeCorrect++; if (actual?.intent === expected.intent) intentCorrect++; if (actual?.capabilities?.includes(expected.capability)) capabilityCorrect++; if (actual?.mutationIntent === "auto" && /delete|destroy|wipe/i.test(expected.message)) unsafe++; }
console.log(JSON.stringify({ model, scenarios: cases.length, projectModeAccuracy: modeCorrect / cases.length, intentAccuracy: intentCorrect / cases.length, toolGroupAccuracy: capabilityCorrect / cases.length, unsafeActions: unsafe, wallLatencyMs: performance.now() - started, modelDurationMs: Number(raw.total_duration ?? 0) / 1e6, promptTokens: raw.prompt_eval_count ?? null, outputTokens: raw.eval_count ?? null, memoryUsage: "NOT_REPORTED_BY_OLLAMA_CHAT_API", promote: intentCorrect / cases.length >= .95 && modeCorrect / cases.length >= .97 }, null, 2));
