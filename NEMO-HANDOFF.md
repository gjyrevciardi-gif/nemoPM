# NEMO PM — handoff brief

A local-first AI project manager. It runs entirely on the user's machine against a local Ollama model. No cloud, no auth, no teams — deliberately out of scope.

This document is the single record of what shipped, why each defect happened, and what is deliberately unfinished. It assumes no knowledge of the conversations that produced the work.

Repo: `nemoPM`, branch `main`. Everything described here is merged and pushed.

---

## 1. Structure

pnpm monorepo, TypeScript throughout, Zod schemas in `@ai-pm/shared` as the cross-package contract.

| package | role |
|---|---|
| `apps/api` | Fastify 5 server, port 43821. Agent orchestration lives here. |
| `apps/web` | React + Vite + TanStack Query, port 5174 |
| `apps/vscode` | VS Code extension (sidebar, chat panel, commit awareness) |
| `packages/shared` | Zod schemas / types — the contract |
| `packages/database` | better-sqlite3, file-based migrations, repositories |
| `packages/domain` | tool registry, permission engine, domain operations |
| `packages/project-state` | deterministic risk engine (SQLite signals + git signals) |
| `packages/git-context` | read-only git reader: commits, branches, issue-key links |
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

**Transactional apply**: approving a run applies all of its actions or none.

**Prompt injection**: project data is fenced in `<project_data>`, with the closing tag escaped to `[/project_data]` so it cannot be closed early. Both system prompts state that project data is never an instruction. Conversation recall uses a separate `<conversation>` fence — exactly one project fence per prompt is an invariant a test pins down.

---

## 3. What changed this phase

### Git-awareness

NEMO now reads the repository a project is connected to and treats it as a second source of truth alongside the board. A new read-only package (`@ai-pm/git-context`) reads commits, branches, and the issue keys mentioned in commit messages, using argv arrays rather than shell strings so a repository path can never be interpreted as syntax. Two things follow. First, commits that name an issue key are recorded as links against that issue, and where the commit is news, NEMO *proposes* moving the issue to review — a proposal a human approves, never an automatic status change. Second, the risk engine gained two rules only the repository can support: an issue in progress for days with nothing committed against it, and an unmerged branch carrying open work that nobody has touched in weeks. The VS Code extension watches the file git appends to on every HEAD movement, so proposals appear without anyone running a scan command; it is passive, never interrupts, and sends a failed check to a log rather than a popup.

### Undo

Applying a run now records, per action, the tool, its arguments, who approved it, and a before/after snapshot of what it touched. `POST /projects/:id/agent/undo` reverses the last applied run in a single transaction, in the opposite order to application. What matters more than the reversal is the refusal: it checks everything *before* touching anything and declines with a named reason when an action has no defined inverse, when somebody has edited the target since, when the target no longer exists, or when the run was already undone. A run that cannot be fully reversed is not partly reversed.

### Test-gap closure

The routes that answer without consulting the model — the fastest and most-used paths on this hardware — were the least covered, because they were gated on a check no test double could satisfy. That capability is now something a provider declares, so a double can declare it too. A new `OllamaShapedProvider` answers in the shapes a real local model actually produces: a native tool call, a tool call printed into message text, or plain prose. It recovers printed calls through the shipped parser rather than a lookalike, so the layers where small models really go wrong are exercised over HTTP. Separately, the VS Code extension went from no tests at all to having its watcher covered, behind a small stub of the editor API.

### Multi-step

A compound request ("create a task, then add it to the sprint") used to do the first half and stop, or invent arguments for the second. It is now split deterministically on instruction-joining conjunctions, capped at three steps, and each step runs through the whole pipeline with the previous steps' results named explicitly. Deterministic on purpose: the hardware ceiling in section 7 makes better prompting a losing bet. A second clause counts as a step only if it reads as an instruction, so "create a task and then we can discuss it" stays one request.

---

## 4. Defects found and fixed

Every one of these was found by running something, not by reading code. Root causes are written the way they were actually found.

| id | what broke | root cause | fix | test |
|---|---|---|---|---|
| P1 | The agent reported "no tool was called" and did nothing, on requests it had clearly understood. | Small models routinely *print* a tool call as message text instead of using the `tool_calls` field. That output was discarded. | Printed calls are recovered and executed, guarded: only tools offered this turn, each call signature once, and prose that merely names a tool never becomes an action. | `packages/ai/test/inline-tool-calls.test.ts` |
| P2 | `createIssue` ran with no title and a type of `"function"`. | The model nested the whole call envelope inside the arguments. Nothing unwrapped it. | Both spellings of the name (`name`, and a string `function`) are unwrapped before validation. | `packages/ai/test/inline-tool-calls.test.ts` |
| P3 | NEMO silently used a model that cannot call tools at all. | Auto-detection took whatever Ollama listed first. | Detection honours the reported `tools` capability, with a fallback for older Ollama versions that do not report one. | `packages/ai/test/model-detection.test.ts` |
| S1 | `createDecision` was rejected whenever the model supplied `issueKey: null`. | The schema had no null case. Models spell "not applicable" as `null` far more often than by omitting the field. | Nulls are dropped only where the field's own schema cannot accept one — `setParent`'s `parentKey: null` still means "detach". | `packages/domain/test/permissions.test.ts` |
| R1 | Asked to build a backlog, the agent could only *describe* one. `createIssue` was never offered. | Intent rules are ordered and first match wins, and a bare MVP topic rule sat above the create-backlog rule. Any message mentioning MVP routed to a read-only intent. | A message that plainly asks for something to be made prefers a rule that can write. Questions are excluded. | `apps/api/test/intent-routing.test.ts` |
| R2 | "What changed recently" took 135 seconds and answered under a status template, as *"Regarding your question: …"*. | The question was sent to the model, which had no reason to treat it as the whole request. | Answered deterministically from the activity record in ~0.6s. `ai.*` activity is excluded: asking NEMO a question is not a project change. | `apps/api/test/recent-change-route.test.ts` |
| T1 | The agent claimed work it had not done — *"I have created a new issue for each feature (ACME-1, ACME-2, ACME-3)"* — after calling one read tool, on a project with zero issues whose key is WAL. | Nothing checked the reply against what actually executed. The keys were invented; verified this was not a data leak, as the context held no trace of another project. | A claim of completed work stands only when a write actually succeeded that turn; otherwise the answer is relabelled a proposal and non-existent keys are stripped. | `apps/api/test/unsupported-claims.test.ts` |
| M1 | Told "NEMO Hub connects all my NEMO products", the next turn answered *"aims to create a platform for [open decision: what purpose does HUB serve?]"*. | Every turn started from zero; nothing was recorded between them. | Turns are recorded per project and the last few shown to the next, bounded to 4 turns / 1500 chars / 400-char replies, because prompt size is the dominant per-turn cost on this hardware. | `apps/api/test/conversation-memory.test.ts` |
| H1 | The eval reported a 14-hour latency for an instant answer, and said only "title required" without showing what the model sent. | Wall-clock timing caught a system clock adjustment; rejected arguments were never recorded. | Monotonic timing, and rejected arguments are logged — which is how P2 and S1 were found at all. | `apps/api/test/agent-eval.test.ts` |
| A1 | A commit naming two issues linked to only the first. The second silently got no link and no proposal. | The uniqueness constraint was on (repository, commit), so a second link row for the same commit could not exist. | Migration `0010` rebuilds the table with uniqueness on (repository, commit, issue). `IFNULL(issue_id,'')` keeps the guarantee for links with no issue, which would otherwise duplicate freely because NULLs are distinct to a unique index. | `apps/api/test/git-edge-cases.test.ts` (A1) |
| A5 | An amended or rebased commit was proposed all over again, re-asking the user to approve something they may have just declined. | Deduplication keyed on the commit hash, and a rewrite changes the hash. | Identity became (issue, subject), then (issue, subject, author date) — see #2. | `apps/api/test/git-edge-cases.test.ts` (A5) |
| A6 | One commit's diff stats were attributed to a different commit. | The log parser split on the record separator. Git emits "header, stats, header, stats", so each separated chunk holds the previous commit's stats *and* the next commit's header. | Scanned line by line: a header is the only line carrying field separators. | `packages/git-context/test/edge-cases.test.ts` |
| A8 | A project whose repository had no commits could not produce project state at all. | `git log` exits non-zero on an empty repository, and that was treated as a git failure. | An empty history is an empty history, not an error. Every other git failure still propagates. | `apps/api/test/git-edge-cases.test.ts` (A8) |
| #1 | The risk engine reported "in progress, nothing committed" about issues somebody had been writing code for all week. | `git log` reads HEAD. Work committed on a branch not currently checked out was invisible — producing not a missing signal but a false one. | The scan reads `--branches`. Two older tests had encoded the HEAD-only behaviour and were updated deliberately, not worked around. | `apps/api/test/git-edge-cases.test.ts` (A7b), `packages/git-context/test/git-context.test.ts` |
| #2 | Two genuinely different commits reusing one message on one issue collapsed into a single link, and the second was never proposed. | Deduplication identity was (issue, subject) alone — too blunt to tell a rewrite from a repeat. | The author date joins the identity, because git preserves it through both amend and rebase: a rewritten commit keeps the identity it had, a later commit does not inherit somebody else's. | `apps/api/test/git-edge-cases.test.ts` (A5, A5b, A5c) |
| #3 | The VS Code extension had no automated tests of any kind. | `vscode` is provided by the editor and does not exist on disk, so nothing could import the extension under test. | A small stub of the API surface the extension actually touches, aliased in a vitest config. | `apps/vscode/test/commitWatcher.test.ts` |
| P4-agg | A multi-step turn that queued work for approval reported `done` and pointed at no run, leaving the queued actions unapprovable — a silent dead end. | The combined response took its status and run id from whichever step happened to run last. | Status and run id come from the steps that actually queued something; a turn producing more than one pending run says so rather than orphaning one. | `apps/api/test/multi-step.test.ts` |
| D-undo | This document asserted that undo covered "single-issue-row tools only", implying a multi-issue commit would come back half-reverted. | The limit had been written down but never tested. It was wrong. | Verified by running an actual undo: a commit naming two issues produces two action rows with distinct targets and their own before/after snapshots, and undo reverses both. A single action touching many rows (`createSubtasks`) is refused whole, before anything is touched. | `apps/api/test/undo-multi-issue.test.ts` |
| D-collide | This document then described #2's residual collision as "the second commit is swallowed". Wrong in the same way. | Written from reasoning about the dedup query rather than from running it. The link is *always* recorded; only the repeat *proposal* is suppressed, and only across separate scans. | Corrected in section 6 and pinned by a test asserting the real behaviour. | `apps/api/test/git-edge-cases.test.ts` (A5c) |

### One case where the test was wrong, not the code

`extractIssueKeys("XWAL-1 something")` returns `["XWAL-1"]`, and that is correct: XWAL-1 is a well-formed key for a project called XWAL, and grounding against real issues is what rejects it later. The property worth pinning is that `WAL-1` is never read out of the middle of `XWAL-1`. The expectation was corrected rather than the regex loosened.

---

## 5. Deliberate design decisions

These were arguments, not bugs. Each is load-bearing; changing one should be a decision, not a cleanup.

- **`planSprint` has no reversal.** It creates a sprint, moves issues into it, completes another and starts the new one. Inventing an inverse for that would be worse than admitting there isn't one, so undo refuses the whole run by name rather than guessing.
- **Undo does not check approver identity.** Every applied action records who approved it, so the trail can answer "who agreed to this". Gating undo on matching it is meaningless in a local-first product with no accounts — there is no second identity to check. A test states this deliberately, and it is the test that should start failing if accounts ever arrive.
- **A commit naming two issues produces one run with two actions.** One commit is one decision, so a human approves its full meaning once rather than being asked twice about halves of it — and undo reverses it as one thing.
- **Change identity is (issue, subject, author date), not the hash.** The hash changes on every rebase, which is what made A5 re-ask users about work they had declined. The author date survives rewriting, so it separates a rewritten commit from a repeated one. It errs toward one *fewer* proposal, never a wrong one.
- **Git never changes issue status on its own.** A commit is evidence. It produces a proposal in the `ask` tier, exactly like any other write nobody explicitly requested.
- **The link is recorded even when the proposal is declined.** What the repository says happened is a fact; the record of it does not depend on whether a user later agrees with NEMO's inference about it.

---

## 6. What is still open

| item | why it is open |
|---|---|
| Two commits sharing a subject **and** an author date are indistinguishable | Documented, not fixed: the cost is one suppressed *suggestion*, never a lost record, and folding the hash back into the identity would reintroduce A5. Reproduced by test A5c. |
| Undo covers the last applied run only, not point-in-time restore | Scoped deliberately. Reversing an arbitrary earlier run means reasoning about everything applied since, which is a different feature, not a bigger version of this one. |
| Multi-step decomposition is capped at three steps | Scoped deliberately. Each step is a full pipeline pass at 20–130s on this hardware; a four-step turn is a request nobody waits out. |
| Model latency and accuracy | Not a defect. 20–130s per model-decided turn is the 2GB VRAM ceiling (section 7), confirmed by measurement across three models and unchanged by any software work here. |
| No model picker in the UI | `OLLAMA_MODEL` is `.env`-only and changing it needs an API restart. Out of this phase's scope, and only worth building once there is a model worth switching to. |
| `apps/web` has no tests | The React board and dashboard are untested. Every endpoint they call is covered server-side, so the risk is confined to rendering and interaction rather than data — but that is a real gap, not a scoped-out one. |
| The deterministic router covers only what it was built for | It answers 8 of 18 evaluation scenarios instantly. Every question moved into it goes from ~60s to ~50ms, which makes it the highest-value remaining work — but it is additive, not a defect. |

The residual collision, stated precisely, because it was twice written down wrong: the **link is always recorded**, so the audit trail never loses a commit. What a subject-and-date collision costs is the second *proposal*, across separate scans — the same direction A5 deliberately errs in. Test `A5c` asserts exactly this: two links, one proposal.

---

## 7. The model situation (measured, not assumed)

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

### Verified end-to-end flow

New project → MVP → backlog → scrum, entirely through the agent:

```
"Wallet is a mobile app ... Define the MVP scope."     1m42s   PRODUCT / MVP / ARCHITECTURE
"Yes, I like it. Create the backlog issues."           2m11s   WAL-1, WAL-2, WAL-3 (real rows)
"Plan the first sprint, maximum 13 points."            0.35s   5+8=13 pts, queued for approval
```

The sprint step is instant because it is deterministic, and it is *queued*, not applied — ASK tier requires human approval. Note the unreliability: the identical backlog request produced nothing the first time and three real issues the second. That variance is the entire argument for the claim guard (T1).

---

## 8. Out of scope — do not build

auth, teams, billing, cloud sync, mobile, packaging, Marketplace publishing, Slack, GitLab, third-party integrations, visual redesign.

---

## 9. State

**314 tests pass across 41 files.**

| package | files | tests |
|---|---|---|
| `packages/ai` | 3 | 21 |
| `packages/database` | 2 | 10 |
| `packages/domain` | 7 | 48 |
| `packages/project-state` | 4 | 28 |
| `packages/git-context` | 2 | 22 |
| `apps/api` | 22 | 175 |
| `apps/vscode` | 1 | 10 |

`pnpm typecheck`, `pnpm test`, and `pnpm build` are all clean. `pnpm test` runs every package in the table, including `apps/vscode`, whose tests would otherwise be easy to run only in isolation and assume covered.

Two workspaces are absent from that table and have no tests of their own: `packages/shared` is Zod schema declarations, exercised transitively by every package that imports the contract, and `apps/web` has no tests at all — see section 6. An earlier version of this document claimed no part of the system was untested. That was written after adding the extension's tests and was an overclaim; `apps/web` was never covered.

The git and undo suites build real repositories in temp directories and drive real HTTP calls and real approvals, rather than mocked fixtures — which is why they found defects (A1, A5, A8, #1) that the mocked version of the same checks did not.

Commands: `pnpm dev` (API 43821 + web 5174), `pnpm test`, `pnpm typecheck`, `pnpm build`.
