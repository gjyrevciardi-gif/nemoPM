# NEMO PM — handoff brief

A local-first AI project manager. Runs entirely on the user's machine against a local Ollama model. No cloud, no auth, no teams — deliberately out of scope.

Repo: `nemoPM`, branch `main` (everything below is merged and pushed).

---

## 1. Structure

pnpm monorepo, TypeScript throughout, Zod schemas in `@ai-pm/shared` as the cross-package contract.

| package | role |
|---|---|
| `apps/api` | Fastify 5 server, port 43821. Agent orchestration lives here. |
| `apps/web` | React + Vite + TanStack Query, port 5174 |
| `apps/vscode` | VS Code extension (chat panel, code context) |
| `packages/shared` | Zod schemas / types — the contract |
| `packages/database` | better-sqlite3, file-based migrations, repositories |
| `packages/domain` | tool registry, permission engine, domain operations |
| `packages/project-state` | deterministic risk engine |
| `packages/ai` | Ollama provider |

**Hard rule: the LLM never touches SQLite.** Every mutation goes through a domain operation, gated by the permission engine.

---

## 2. How an agent turn works

```
message
  -> makeRoutingDecision()        project mode + intent + mutationIntent
  -> routeAgentTools()            narrows ~39 tools to ~6 for this turn
  -> deterministic short-circuits answer without the model where possible
  -> provider.runAgent()          model picks tools
  -> decideToolCall()             server-side permission check per call
  -> domain operation -> SQLite
  -> correctUnsupportedClaims()   reply must match what actually happened
```

**Permission tiers**, enforced server-side; the model never sees them:

- `auto` — runs immediately (reads, low-risk writes)
- `ask` — described and queued into an agent run a human must approve
- `blocked` — never callable (project deletion, bulk delete)

**Transactional apply**: approving a run applies all actions or none.

**Prompt injection**: project data is fenced in `<project_data>`, with the closing tag escaped to `[/project_data]` so it cannot be closed early. Both system prompts state that project data is never an instruction. Conversation recall uses a separate `<conversation>` fence — exactly one project fence per prompt is an invariant a test pins down.

---

## 3. The model situation (measured, not assumed)

Hardware: i7-1165G7 (15W, 4 cores), **NVIDIA MX450 with 2GB VRAM**. This is the binding constraint on everything.

Same 18-scenario evaluation, same seeded project, same scoring:

| model | ceiling | score | median | notes |
|---|---|---|---|---|
| **llama3.1:latest** (8B) | 120s | **15/18** | 34.0s | current default |
| llama3.1:latest | 75s | 15/18 | 57.4s | 3 failures sat exactly at the ceiling |
| llama3.1:latest | 90s (older run) | 18/18 | 30.2s | a lucky run |
| qwen2.5:3b | 75s | 11/18 | 34.2s | first 4 scenarios died on cold load |
| llama3.2:1b | 75s | 12/18 | 17.2s | emits malformed JSON |

Config in `.env`: `OLLAMA_MODEL=llama3.1`, `OLLAMA_TIMEOUT_MS=120000`.

**Critical caveat about the headline number.** Of 18 scenarios, 8 are answered by the deterministic router with **zero model calls**, in under a second. Only 9–10 actually exercise the model, and it gets roughly half of those right. Do not read "15/18" as "the model is 83% correct".

Run it: `cd apps/api && pnpm run eval:model` (~15 min, writes `eval-report.md` and `.json`). One scenario: `EVAL_ONLY="update priority" pnpm run eval:model`.

---

## 4. Defects fixed — all found by measurement, not review

### Provider level — small models fail in ways that looked like NEMO refusing to act

1. Models routinely *print* a tool call as message text instead of using `tool_calls`. That decision was discarded and reported as "no tool was called". Now recovered, guarded: only tools offered this turn, each call signature runs once, and prose that merely names a tool never becomes an action.
2. Some nest the whole envelope inside the arguments — `{type:"function",name:"createIssue",parameters:{...}}` — so `createIssue` saw no title and a type of `"function"`. Both spellings of the name (`name`, and a string `function`) unwrap now.
3. Model auto-detection took whatever Ollama listed first, which can be a model with no tool support at all. It now honours the reported `tools` capability.

### Schema

4. `createDecision` refused `issueKey: null`. Models spell "not applicable" as `null` far more often than by omitting a field. Nulls are now dropped only where the schema cannot take one — `setParent`'s `parentKey: null` means "detach" and still works.

### Routing

5. Intent rules are ordered and first match wins, and a bare `/\bmvp\b/` topic rule sat above the create-backlog rule. Any message mentioning MVP routed to a read-only intent, so `createIssue` was never offered and the agent could only *describe* the backlog it had been asked to build. A message that plainly asks for something to be made now prefers a rule that can write. Questions are excluded.
6. "What changed recently" went to the model: 135 seconds, and the one-line answer arrived buried under a status template as *"Regarding your question: ..."*. Now answered from the record in ~0.6s. `ai.*` activity is excluded — asking NEMO a question is not a project change.

### Truthfulness

7. **The agent claimed work it never did.** Asked to build a backlog for a new Wallet project, llama3.1 replied *"I have created a new issue for each feature (ACME-1, ACME-2, ACME-3). These issues are now part of the project backlog."* It had called one read tool. The project had zero issues, and its key is WAL, not ACME. Verified this was not a data leak — the context contained no trace of another project; the keys were invented. A claim of completed work now only stands when a write actually succeeded that turn; otherwise the answer is relabelled a proposal and non-existent keys are stripped.

### Memory

8. Every turn started from zero. Told "NEMO Hub connects all my NEMO products", the next turn answered *"aims to create a platform for [open decision: what purpose does HUB serve?]"*. Turns are now recorded per project and the last few shown to the next — bounded to 4 turns / 1500 chars / 400-char replies, because prompt size is the dominant cost per turn on this hardware. Project-scoped, with tests that it cannot leak between projects.

### Harness

9. The eval reported a 14-hour latency for an instant answer (wall clock caught by a system clock adjustment) — now monotonic. It also said only "title required" without showing what the model actually sent; it now records rejected arguments, which is how defects 2 and 4 were found.

---

## 5. Verified end-to-end flow

New project → MVP → backlog → scrum, entirely through the agent:

```
"Wallet is a mobile app ... Define the MVP scope."     1m42s   PRODUCT / MVP / ARCHITECTURE
"Yes, I like it. Create the backlog issues."           2m11s   WAL-1, WAL-2, WAL-3 (real rows)
"Plan the first sprint, maximum 13 points."            0.35s   5+8=13 pts, queued for approval
```

The sprint step is instant because it is deterministic, and it is *queued*, not applied — ASK tier requires human approval.

**Note the unreliability**: the identical backlog request produced nothing the first time and three real issues the second. That variance is the entire argument for the claim guard.

---

## 6. State

- **217 tests pass** — `ai` 21, `database` 10, `project-state` 17, `domain` 48, `api` 121
- `pnpm typecheck`, `pnpm test`, `pnpm build` all clean
- Merged to `main` and pushed

Commands: `pnpm dev` (API 43821 + web 5174), `pnpm test`, `pnpm typecheck`, `pnpm build`.

---

## 7. Known gaps — the honest list

1. **Multi-step continuation.** "Create a task, then add it to the sprint" does step one and stops, or invents arguments for step two. Measured, not fixed. This is the clearest next piece of work.
2. **Latency.** 20–130s for anything the model must decide. This is the 2GB VRAM ceiling, not a software problem. More VRAM is a 10–30× change; nothing in software comes close.
3. **The deterministic router only covers what it was built for.** It handles 8 of 18 scenarios instantly. Every question moved into it goes from ~60s to ~50ms — the highest-value remaining work, worth more than any model swap.
4. **No model picker in the UI.** `OLLAMA_MODEL` is `.env`-only; changing it needs an API restart.
5. **Deterministic routes are gated on the real Ollama provider**, so HTTP tests using the scripted model cannot exercise them. Their predicates are unit-tested; their rendering was verified manually against real projects. That coverage gap is real and worth closing.
6. **`update priority`** — the model reads the issue and writes prose instead of calling `setPriority`. Genuine model weakness, not a NEMO bug.

---

## 8. Out of scope — do not build

auth, teams, billing, cloud sync, mobile, packaging, Marketplace publishing, Slack, GitLab, third-party integrations, visual redesign.
