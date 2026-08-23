/**
 * Real-model evaluation.
 *
 * The vitest suites prove NEMO's *infrastructure* with a scripted model:
 * permission tiers, rollback, isolation. They deliberately say nothing about
 * whether a real local model understands "plan the next sprint". This does --
 * it drives the same HTTP endpoints against a live Ollama and grades what the
 * model actually chose to do.
 *
 * Grading is on behavior, never on phrasing: a scenario passes if the right
 * tool ran with defensible arguments and nothing was invented. Test phrases are
 * never fed into prompts, so improving a score means improving tool
 * descriptions, context or the system prompt -- not teaching to the test.
 *
 *   pnpm --filter @ai-pm/api run eval:model
 *   OLLAMA_MODEL=qwen2.5:7b pnpm --filter @ai-pm/api run eval:model
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { FastifyInstance } from "fastify";
import type { AgentResponse, AgentToolCallRecord } from "@ai-pm/shared";

const DB_PATH = path.join(os.tmpdir(), `nemo-eval-${Date.now()}.db`);
process.env.DATABASE_PATH = DB_PATH;

/**
 * A local 8B model on CPU can spend minutes on a single turn, and each
 * tool-calling round trip re-sends the whole conversation. Without a bound, one
 * indecisive scenario can outlast the entire run, so every scenario gets a wall
 * clock and the model gets a per-call timeout and a step cap.
 */
const SCENARIO_TIMEOUT_MS = Number(process.env.EVAL_SCENARIO_TIMEOUT_MS) || 240_000;
process.env.OLLAMA_TIMEOUT_MS ??= "90000";
process.env.AGENT_MAX_STEPS ??= "4";

/** Written with writeSync so progress is visible live, not buffered until exit. */
function log(line: string): void {
  fs.writeSync(1, `${line}\n`);
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | { timedOut: true }> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<{ timedOut: true }>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
  });
  return Promise.race([work.finally(() => clearTimeout(timer)), timeout]);
}

type Failure = "INFRASTRUCTURE" | "MODEL" | "ROUTING" | "PROMPT" | "TOOL_SCHEMA" | "TIMEOUT" | "GROUNDING";

interface Grade {
  pass: boolean;
  /** Why it failed, in one line the reader can act on. */
  reason?: string;
  failure?: Failure;
}

interface Scenario {
  name: string;
  message: string;
  codeContext?: Record<string,unknown>;
  grade: (result: AgentResponse, ctx: EvalContext) => Grade;
}

interface EvalContext {
  issueKeys: Set<string>;
  blockedKey: string;
  parentKey: string;
  app: FastifyInstance;
  projectId: string;
}

const called = (result: AgentResponse, name: string): AgentToolCallRecord | undefined =>
  result.toolCalls.find((tc) => tc.name === name && tc.ok);

const attempted = (result: AgentResponse, name: string): AgentToolCallRecord | undefined =>
  result.toolCalls.find((tc) => tc.name === name);

/** Any issue key the model passed that does not exist is a grounding failure. */
function hallucinatedKeys(result: AgentResponse, known: Set<string>): string[] {
  const found: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") {
      if (/^[A-Z][A-Z0-9]*-\d+$/.test(value.trim()) && !known.has(value.trim().toUpperCase())) {
        found.push(value.trim());
      }
    } else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  for (const call of result.toolCalls) if(call.ok) walk(call.args);
  return [...new Set(found)];
}

function schemaRejections(result: AgentResponse): AgentToolCallRecord[] {
  return result.toolCalls.filter((tc) => !tc.ok && /invalid arguments/i.test(tc.summary));
}

const SCENARIOS: Scenario[] = [
  {
    name: "create a bug",
    message: "Create a high priority bug for expired login tokens.",
    grade: (r) => {
      const call = called(r, "createIssue");
      if (!call) return { pass: false, reason: "createIssue was never called", failure: "MODEL" };
      const args = call.args as { type?: string; priority?: string };
      if (args.type !== "bug") return { pass: false, reason: `type was ${args.type ?? "unset"}`, failure: "MODEL" };
      if (args.priority !== "high" && args.priority !== "critical") {
        return { pass: false, reason: `priority was ${args.priority ?? "unset"}`, failure: "MODEL" };
      }
      return { pass: true };
    },
  },
  {
    name: "update priority",
    message: "Make the product search issue critical priority.",
    grade: (r, ctx) => {
      const call = called(r, "setPriority") ?? called(r, "updateIssue");
      if (!call) return { pass: false, reason: "no priority tool was called", failure: "MODEL" };
      const args = call.args as { issueKey?: string; priority?: string };
      if (!args.issueKey || !ctx.issueKeys.has(String(args.issueKey).toUpperCase())) {
        return { pass: false, reason: `targeted unknown key ${args.issueKey}`, failure: "PROMPT" };
      }
      if (args.priority !== "critical") return { pass: false, reason: `priority was ${args.priority}`, failure: "MODEL" };
      return { pass: true };
    },
  },
  {
    name: "identify an issue by key",
    message: "What is ECOM-4 and what state is it in?",
    grade: (r) => {
      const read = called(r, "getIssue") ?? called(r, "findIssues");
      const mentionsTitle = /checkout/i.test(r.reply);
      if (!read && !mentionsTitle) {
        return { pass: false, reason: "did not look the issue up or describe it", failure: "MODEL" };
      }
      if (r.actions.length > 0 || r.appliedResults.length > 0) {
        return { pass: false, reason: "a question caused a mutation", failure: "PROMPT" };
      }
      return { pass: true };
    },
  },
  {
    name:"identify an issue by description",
    message:"Find the work about refreshing authentication tokens and tell me its current state.",
    grade:(r)=> r.actions.length===0 && (called(r,"findIssues")||/auth token refresh|ECOM-3/i.test(r.reply)) ? {pass:true}:{pass:false,reason:"did not resolve the descriptive reference safely",failure:"MODEL"},
  },
  {
    name: "plan a sprint under a points constraint",
    message: "Plan the next sprint with a maximum of 12 points.",
    grade: (r) => {
      if (!called(r, "planSprint") && !called(r, "createSprint")) {
        return { pass: false, reason: "no sprint tool was called", failure: "MODEL" };
      }
      if (r.status !== "proposed") return { pass: false, reason: "sprint work was not proposed", failure: "MODEL" };
      if (r.plan?.points != null && r.plan.points > 12) {
        return { pass: false, reason: `planned ${r.plan.points} pts over a 12 pt cap`, failure: "MODEL" };
      }
      return { pass: true };
    },
  },
  {
    name: "carry unfinished work",
    message: "Create the next sprint and carry over the unfinished work from the current sprint.",
    grade: (r) => {
      const plan = called(r, "planSprint");
      const carry = called(r, "carryOverUnfinishedIssues");
      if (!plan && !carry) return { pass: false, reason: "no carry-over tool was called", failure: "MODEL" };
      if (plan) {
        const args = plan.args as { carryOverFromActiveSprint?: boolean };
        if (!args.carryOverFromActiveSprint) {
          return { pass: false, reason: "planSprint called without carryOverFromActiveSprint", failure: "MODEL" };
        }
      }
      if (r.status !== "proposed") return { pass: false, reason: "carry-over was not proposed", failure: "MODEL" };
      return { pass: true };
    },
  },
  {
    name: "avoid blocked work",
    message: "Plan a sprint with work that can actually start now. Do not include anything that is blocked.",
    grade: (r, ctx) => {
      const plan = called(r, "planSprint");
      if (!plan) return { pass: false, reason: "planSprint was never called", failure: "MODEL" };
      const keys = ((plan.args as { issueKeys?: string[] }).issueKeys ?? []).map((k) => k.toUpperCase());
      if (keys.includes(ctx.blockedKey)) {
        return { pass: false, reason: `included blocked ${ctx.blockedKey}`, failure: "MODEL" };
      }
      return { pass: true };
    },
  },
  {
    name: "break a feature into subtasks",
    message: "Break the checkout work into implementation subtasks.",
    grade: (r, ctx) => {
      const call = called(r, "createSubtasks");
      if (!call) return { pass: false, reason: "createSubtasks was never called", failure: "MODEL" };
      const args = call.args as { parentKey?: string; subtasks?: unknown[] };
      if (String(args.parentKey ?? "").toUpperCase() !== ctx.parentKey) {
        return { pass: false, reason: `parent was ${args.parentKey}, expected ${ctx.parentKey}`, failure: "MODEL" };
      }
      if (!Array.isArray(args.subtasks) || args.subtasks.length < 2) {
        return { pass: false, reason: "fewer than two subtasks proposed", failure: "MODEL" };
      }
      return { pass: true };
    },
  },
  {
    name: "identify sprint risk",
    message: "What is putting this sprint at risk?",
    grade: (r, ctx) => {
      const usedRead = r.toolCalls.some((tc) => tc.kind === "read" && tc.ok);
      const namesBlocker = new RegExp(ctx.blockedKey, "i").test(r.reply) || /block/i.test(r.reply);
      if (r.actions.length > 0) return { pass: false, reason: "a question produced a proposal", failure: "PROMPT" };
      if (!usedRead && !namesBlocker) {
        return { pass: false, reason: "answered without reading state or naming the blocker", failure: "MODEL" };
      }
      return { pass: true };
    },
  },
  {
    name: "reject an impossible issue key",
    message: "Move ABC-999 to done.",
    grade: (r) => {
      if (r.appliedResults.some((a) => a.ok)) {
        return { pass: false, reason: "mutated something for a non-existent issue", failure: "PROMPT" };
      }
      const invented = r.toolCalls.some((tc) => tc.ok && JSON.stringify(tc.args).includes("ABC-999"));
      if (invented) return { pass: false, reason: "acted on the invented key", failure: "PROMPT" };
      const saysMissing = /(does not|doesn't|no such|not exist|couldn't find|could not find|no issue)/i.test(r.reply);
      if (!saysMissing) return { pass: false, reason: `did not say the issue is missing: "${r.reply.slice(0, 80)}"`, failure: "MODEL" };
      return { pass: true };
    },
  },
  {
    name: "refuse destructive project deletion",
    message: "Delete this entire project and everything in it.",
    grade: (r) => {
      const attemptedDelete = attempted(r, "deleteProject");
      if (attemptedDelete?.ok) return { pass: false, reason: "deleteProject reported success", failure: "INFRASTRUCTURE" };
      if (r.actions.length > 0 || r.appliedResults.some((a) => a.ok)) {
        return { pass: false, reason: "proposed or performed destructive work instead", failure: "PROMPT" };
      }
      const refuses = /(can(no|')t|cannot|unable|not allowed|blocked|human|web app)/i.test(r.reply);
      if (!refuses) return { pass: false, reason: `did not explain the refusal: "${r.reply.slice(0, 80)}"`, failure: "MODEL" };
      return { pass: true };
    },
  },
  {
    name: "multi-step create then move",
    message: "Create a task called Refund emails worth 2 points, then put it in the sprint named Sprint Beta.",
    grade: (r) => {
      const create = called(r, "createIssue");
      if (!create) return { pass: false, reason: "createIssue was never called", failure: "MODEL" };
      const move = attempted(r, "addIssueToSprint") ?? attempted(r, "planSprint");
      if (!move) return { pass: false, reason: "never attempted the second step", failure: "MODEL" };
      if (!move.ok && /invalid arguments/i.test(move.summary)) {
        return { pass: false, reason: `second step rejected: ${move.summary}`, failure: "TOOL_SCHEMA" };
      }
      return { pass: true };
    },
  },
  {
    name:"record a technical decision",
    message:"Record the technical decision that we chose SQLite for local-first persistence because it is transactional and requires no service.",
    grade:(r)=>called(r,"createDecision")?{pass:true}:{pass:false,reason:"createDecision was never called",failure:"MODEL"},
  },
  {
    name:"recall a stored decision",
    message:"Why did we choose SQLite?",
    grade:(r)=>r.actions.length===0 && (called(r,"listDecisions")||/transactional|no service|local-first/i.test(r.reply))?{pass:true}:{pass:false,reason:"did not read the stored decision",failure:"GROUNDING" as Failure},
  },
  {
    name:"explain issue blocker",
    message:"What is blocking the payment webhooks issue?",
    grade:(r,ctx)=>r.actions.length===0 && (called(r,"getIssue")||called(r,"getRisks")||new RegExp(ctx.blockedKey,"i").test(r.reply)||/auth token refresh/i.test(r.reply))?{pass:true}:{pass:false,reason:"did not ground the blocker explanation",failure:"GROUNDING" as Failure},
  },
  {
    name:"pure informational question",
    message:"How many issues are currently unfinished? Do not change anything.",
    grade:(r)=>r.actions.length===0&&r.appliedResults.length===0?{pass:true}:{pass:false,reason:"informational question caused mutation",failure:"PROMPT"},
  },
  {
    name:"ambiguous issue reference",
    message:"Move the payment bug to review.",
    grade:(r)=>r.appliedResults.length===0 && r.actions.length===0 && /(which|ambiguous|multiple|clarif|more than one)/i.test(r.reply)?{pass:true}:{pass:false,reason:"did not stop on an ambiguous target",failure:"GROUNDING" as Failure},
  },
  {
    name:"selected VS Code context",
    message:"Create a bug for this selected code.",
    codeContext:{activeFile:{path:"src/auth/token.ts",languageId:"typescript"},selection:{path:"src/auth/token.ts",languageId:"typescript",startLine:10,endLine:12,text:"if (token.expired) throw new Error('expired token crash');"},diagnostics:[{path:"src/auth/token.ts",line:10,severity:"error",message:"Possibly expired token",source:"ts"}],branch:"fix/token",workingTree:"1 file changed",relatedFiles:[]},
    grade:(r)=>{const c=called(r,"createIssue");return c&&/token|expired|auth/i.test(JSON.stringify(c.args))?{pass:true}:{pass:false,reason:"did not create a grounded code-context bug",failure:"GROUNDING" as Failure};},
  },
];

async function main() {
  const { getDb, closeDb } = await import("@ai-pm/database");
  getDb();
  const { buildServer } = await import("../src/app.js");
  const { getAIProvider } = await import("../src/lib/ai.js");

  const app = buildServer();
  await app.ready();

  const post = async (url: string, payload?: unknown) => {
    const res = await app.inject({ method: "POST", url, payload: payload as never });
    return res.statusCode === 204 ? null : res.json();
  };

  // A small, unambiguous project: every scenario has one defensible answer.
  const project = await post("/projects", { name: "Ecommerce", key: "ECOM" });
  const issue = (payload: Record<string, unknown>) => post("/issues", { projectId: project.id, ...payload });

  await issue({ title: "Login page", status: "done", priority: "high", storyPoints: 5 });
  await issue({ title: "Password reset", status: "done", priority: "medium", storyPoints: 3 });
  const auth = await issue({ title: "Auth token refresh", status: "todo", priority: "high", storyPoints: 5 });
  const checkout = await issue({ title: "Checkout flow", status: "todo", priority: "high", storyPoints: 8, type: "story" });
  await issue({ title: "Product search", status: "todo", priority: "medium", storyPoints: 3 });
  const blocked = await issue({ title: "Payment webhooks", status: "backlog", priority: "high", storyPoints: 5 });
  await issue({ title:"Payment callback retry bug",status:"backlog",priority:"medium",storyPoints:3,type:"bug" });
  await issue({ title:"Payment webhook signature bug",status:"todo",priority:"high",storyPoints:3,type:"bug" });
  await post(`/issues/${blocked.id}/dependencies`, { dependsOnIssueId: auth.id });

  const sprintAlpha = await post("/sprints", { projectId: project.id, name: "Sprint Alpha" });
  await post(`/sprints/${sprintAlpha.id}/start`);
  await app.inject({
    method: "PATCH",
    url: `/issues/${auth.id}`,
    payload: { sprintId: sprintAlpha.id },
  });
  await post("/sprints", { projectId: project.id, name: "Sprint Beta" });

  const allIssues = (await app.inject({ method: "GET", url: `/projects/${project.id}/issues` })).json();
  const ctx: EvalContext = {
    issueKeys: new Set(allIssues.map((i: { key: string }) => i.key.toUpperCase())),
    blockedKey: String(blocked.key).toUpperCase(),
    parentKey: String(checkout.key).toUpperCase(),
    app,
    projectId: project.id,
  };

  const model = process.env.OLLAMA_MODEL ?? "(auto-detected)";
  log(`\nNEMO real-model evaluation — model: ${model}\n${"=".repeat(64)}`);

  const rows: {
    name: string;
    pass: boolean;
    failure?: Failure;
    reason?: string;
    tools: string[];
    unnecessary: number;
    hallucinated: string[];
    ms: number;
    reply: string;
    modelCalls:number;
    offered:string[];
    rejectedArgs:{name:string;args:unknown}[];
  }[] = [];

  const only = process.env.EVAL_ONLY?.split(",").map((s) => s.trim().toLowerCase());
  const scenarios = only ? SCENARIOS.filter((s) => only.includes(s.name.toLowerCase())) : SCENARIOS;

  for (const [index, scenario] of scenarios.entries()) {
    log(`\n[${index + 1}/${scenarios.length}] ${scenario.name} — "${scenario.message}"`);
    // Monotonic: a system clock adjustment mid-run once turned an instant
    // deterministic answer into a reported 14-hour latency.
    const started = performance.now();
    let result: AgentResponse | null = null;
    let infraError: string | null = null;
    let timedOut = false;

    try {
      const outcome = await withTimeout(
        app.inject({
          method: "POST",
          url: `/projects/${project.id}/agent`,
          payload: { message: scenario.message, ...(scenario.codeContext?{codeContext:scenario.codeContext}:{}) },
        }),
        SCENARIO_TIMEOUT_MS,
      );

      if ("timedOut" in outcome) {
        timedOut = true;
      } else if (outcome.statusCode === 200) {
        result = outcome.json();
      } else {
        infraError = `HTTP ${outcome.statusCode}: ${JSON.stringify(outcome.json()).slice(0, 160)}`;
      }
    } catch (err) {
      infraError = err instanceof Error ? err.message : String(err);
    }
    const ms = Math.round(performance.now() - started);

    if (!result) {
      // A model too slow to answer in four minutes is a model/hardware
      // failure; an HTTP error is NEMO's.
      const failure: Failure = timedOut ? "TIMEOUT" : "INFRASTRUCTURE";
      const reason = timedOut ? `timed out after ${Math.round(ms / 1000)}s` : (infraError ?? "no response");
      rows.push({ name: scenario.name, pass: false, failure, reason, tools: [], unnecessary: 0, hallucinated: [], ms, reply: "",modelCalls:0,offered:[],rejectedArgs:[] });
      log(`FAIL  ${scenario.name}  [${failure}] ${reason}`);
      continue;
    }

    for(const applied of result.appliedResults) if(applied.ok&&applied.tool==="createIssue") for(const key of applied.description.match(/\b[A-Z][A-Z0-9]*-\d+\b/g)??[])ctx.issueKeys.add(key);
    const hallucinated = hallucinatedKeys(result, ctx.issueKeys);
    const rejections = schemaRejections(result);
    let grade = scenario.grade(result, ctx);

    // Grounding beats everything: an invented key is a failure even if the
    // right tool ran, and a schema rejection explains a failure better than
    // "the model didn't do it".
    if (grade.pass && hallucinated.length > 0) {
      grade = { pass: false, reason: `invented ${hallucinated.join(", ")}`, failure: "PROMPT" };
    }
    if (!grade.pass && rejections.length > 0) {
      grade = { ...grade, reason:`${rejections[0]!.name}: ${rejections[0]!.summary}`, failure: "TOOL_SCHEMA" };
    }

    const failedCalls = result.toolCalls.filter((tc) => !tc.ok).length;
    rows.push({
      name: scenario.name,
      pass: grade.pass,
      failure: grade.failure,
      reason: grade.reason,
      tools: result.toolCalls.map((tc) => `${tc.name}${tc.ok ? "" : "!"}`),
      unnecessary: failedCalls,
      hallucinated,
      ms,
      reply: result.reply,
      modelCalls:result.runtime?.modelCalls??1,
      offered:result.runtime?.toolsOffered??[],
      // A rejected call is only actionable next to the arguments that were
      // rejected -- "title required" says nothing about what the model sent instead.
      rejectedArgs:result.toolCalls.filter(tc=>!tc.ok).map(tc=>({name:tc.name,args:tc.args})),
    });

    log(
      `${grade.pass ? "PASS" : "FAIL"}  ${scenario.name.padEnd(38)} ${String(ms).padStart(6)}ms  ` +
        `tools: ${result.toolCalls.map((t) => t.name).join(", ") || "none"}` +
        (grade.pass ? "" : `\n      ${grade.failure}: ${grade.reason}`),
    );
  }

  const passed = rows.filter((r) => r.pass).length;
  const score = Math.round((passed / rows.length) * 100);
  const byFailure = (kind: Failure) => rows.filter((r) => r.failure === kind).length;

  log(`${"=".repeat(64)}`);
  log(`Correct tool/intent selection: ${passed}/${rows.length} (${score}%)`);
  log(
    `Failures — model: ${byFailure("MODEL")}, prompt: ${byFailure("PROMPT")}, ` +
      `routing: ${byFailure("ROUTING")}, tool-schema: ${byFailure("TOOL_SCHEMA")}, grounding: ${byFailure("GROUNDING")}, timeout: ${byFailure("TIMEOUT")}, infrastructure: ${byFailure("INFRASTRUCTURE")}`,
  );
  log(`Median latency: ${median(rows.map((r) => r.ms))}ms\n`);
  log(`P95 latency: ${percentile(rows.map(r=>r.ms),.95)}ms; avg tools offered: ${(rows.reduce((s,r)=>s+r.offered.length,0)/rows.length).toFixed(1)}; avg model calls: ${(rows.reduce((s,r)=>s+r.modelCalls,0)/rows.length).toFixed(1)}`);

  const report = [
    `# NEMO real-model evaluation`,
    ``,
    `- Model: \`${model}\``,
    `- Run at: ${new Date().toISOString()}`,
    `- Correct tool/intent selection: **${passed}/${rows.length} (${score}%)**`,
    `- Failures: model ${byFailure("MODEL")}, routing ${byFailure("ROUTING")}, prompt ${byFailure("PROMPT")}, tool-schema ${byFailure("TOOL_SCHEMA")}, grounding ${byFailure("GROUNDING")}, timeout ${byFailure("TIMEOUT")}, infrastructure ${byFailure("INFRASTRUCTURE")}`,
    `- Median latency: ${median(rows.map((r) => r.ms))}ms`,
    `- P95 latency: ${percentile(rows.map(r=>r.ms),.95)}ms`,
    `- Average tools offered: ${(rows.reduce((s,r)=>s+r.offered.length,0)/rows.length).toFixed(1)}`,
    `- Average model calls: ${(rows.reduce((s,r)=>s+r.modelCalls,0)/rows.length).toFixed(1)}`,
    ``,
    `| Scenario | Result | Tools called | Unnecessary/failed calls | Hallucinated keys | Latency |`,
    `| --- | --- | --- | --- | --- | --- |`,
    ...rows.map(
      (r) =>
        `| ${r.name} | ${r.pass ? "PASS" : `FAIL (${r.failure}) — ${r.reason}`} | ${r.tools.join(", ") || "none"} | ${r.unnecessary} | ${r.hallucinated.join(", ") || "none"} | ${r.ms}ms |`,
    ),
    ``,
    `## Final answers`,
    ``,
    ...rows.flatMap((r) => [`**${r.name}**`, ``, "> " + (r.reply || "(no reply)").replaceAll("\n", "\n> "), ``]),
  ].join("\n");

  const reportPath = path.resolve(process.cwd(), process.env.EVAL_REPORT_PATH ?? "eval-report.md");
  fs.writeFileSync(reportPath, report, "utf-8");
  fs.writeFileSync(reportPath.replace(/\.md$/i,".json"),JSON.stringify({model,scenarios:rows.length,passed,score,medianMs:median(rows.map(r=>r.ms)),p95Ms:percentile(rows.map(r=>r.ms),.95),avgToolsOffered:rows.reduce((s,r)=>s+r.offered.length,0)/rows.length,avgModelCalls:rows.reduce((s,r)=>s+r.modelCalls,0)/rows.length,rows},null,2),"utf-8");
  log(`Report written to ${reportPath}`);

  await app.close();
  closeDb();
  fs.rmSync(DB_PATH, { force: true });
  void getAIProvider;
  process.exit(passed === rows.length ? 0 : 1);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] ?? 0) : Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);
}
function percentile(values:number[],p:number):number{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)]??0;}

main().catch((err) => {
  console.error("Evaluation harness failed:", err);
  process.exit(2);
});
