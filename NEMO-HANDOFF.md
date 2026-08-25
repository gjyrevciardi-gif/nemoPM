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

- **312 tests pass** — `ai` 21, `database` 10, `vscode` 10, `git-context` 22, `project-state` 28, `domain` 48, `api` 173
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

---

## 9. Edge-case sweep — results

Every case below has a committed test running against real sequential state
(real repositories built in temp directories, real HTTP calls, real approvals),
never mocked fixtures. Two of the four defects found were invisible to the
mocked version of the same check.

| # | Case | Before fix | Fix applied | Test |
|---|---|---|---|---|
| A1 | Commit naming two issues | **FAIL** — only the first issue linked | Migration `0010`: uniqueness is per (repo, commit, issue), not per (repo, commit) | `A1 — a commit that names two issues` |
| A2 | Commit with no valid key | PASS | — | `A2 — commits with no issue key` |
| A2b | Key hidden in a longer token | *test was wrong* | Corrected the expectation, not the code — see below | `does not find a key inside a longer token` |
| A3 | Key that exists nowhere | PASS | — | `A3 — a key that exists nowhere` |
| A4 | Monorepo, two projects one repo | PASS | — | `A3 / A4 — keys belonging to another project` |
| A5 | Amended / rebased commit | **FAIL** — re-proposed the same move | Dedupe on (issue, commit subject), which survives a rewrite | `A5 — a commit that was amended or rebased` |
| A6 | header/stats/header/stats parse | PASS (already fixed) | Regression locked permanently | `A6 — the header/stats/header/stats parse` |
| A7 | Fresh local branch | PASS | — | `A7 — a fresh local branch` |
| A8 | Repository with no commits | **FAIL** — `git log` threw | Empty history is not an error; other git failures still propagate | `A8 — a repository with no history at all` |
| C1 | Write queued, not applied | PASS | — | `C1 — a write that was queued, not applied` |
| C2 | Key proposed by commit, unapproved | PASS | — | `C2 — an issue key proposed by a commit…` |
| D1 | Turn right after a git proposal | PASS | — | `D1 — the turn right after a git proposal` |
| D2 | Two projects, one receiving commits | PASS | — | `D2 — two projects, one of them receiving commits` |
| E1 | Ambiguous read/write phrasing | PASS | — | `E1 — ambiguous phrasing…` (fresh phrasings) |

### Design decision: a commit that names two issues (A1)

`git commit -m "WAL-1, WAL-2: shared login refactor"` is one commit and two
pieces of work. The original schema could only record it against whichever
issue was seen first, and the second issue silently got no link and no proposed
transition — silently being the problem, since nothing reported that half the
commit's meaning had been dropped.

**Decided: link both, propose both, one run.** The uniqueness that matters is
one link per (repository, commit, issue). SQLite cannot drop a table-level
constraint, so `0010` rebuilds the table; `IFNULL(issue_id,'')` keeps the
guarantee for links with no issue, which would otherwise duplicate freely
because NULLs are distinct to a unique index. Both moves land in a single run,
so a human approves the commit's full meaning in one decision rather than two.

### Design decision: rewritten commits (A5)

An amend or rebase gives the same logical change a new hash, so hash-based
deduplication saw a brand new commit and proposed a move the user may have just
declined. Identity across a rewrite is (issue, commit subject) — not perfect, as
two genuinely different commits with identical subjects on one issue collapse
into one proposal, but re-asking a user to approve something they declined is
the worse failure.

### A note on A2b — the test was wrong, not the code

`extractIssueKeys("XWAL-1 something")` returns `["XWAL-1"]`, and that is
correct: XWAL-1 is a well-formed key for a project called XWAL, and grounding
against real issues is what rejects it later. The property worth pinning is that
`WAL-1` is never read out of the middle of `XWAL-1`. The expectation was
corrected rather than the regex loosened.

### Sections B and E2 — not yet runnable

B (undo/rollback) and E2 (HTTP tests through a scripted mock provider) test
features that do not exist yet: Priority 2 and Priority 3 of the phase brief.
Those six cases are not marked pass or fail here because there is nothing to run
them against; they should be written as part of building each feature.

### Running list — cases found while sweeping, not yet chased

Per the sweep rules, recorded rather than pursued:

1. A commit on a branch that is not checked out is invisible to `git log`, which
   reads HEAD. Links already recorded survive a branch switch, but a commit made
   on a branch NEMO never sees checked out is never linked at all.
2. `hasCodeLinkWithSubject` collapses two genuinely different commits that share
   a subject on one issue. Accepted deliberately (see A5), worth revisiting if
   users hit it.
3. The VS Code `CommitWatcher` has no automated test — it needs the VS Code API.
   Its server-side effects are covered; the watcher itself is verified by hand.

---

## 10. Priorities 2–4

### Priority 2 — undo

Apply records a before/after snapshot per action, plus the tool, its arguments
and who approved it. Undo reverses the last applied run, in one transaction, in
the opposite order to application.

It refuses *before touching anything* in four cases: an action whose tool has no
defined inverse (`NO_REVERSAL`), a target somebody edited since (`CONFLICT`), a
target that no longer exists (`TARGET_GONE`), and a run already undone
(`ALREADY_REVERTED`). Reversible tools are the ones whose effect is a single
issue row; `planSprint` creates a sprint, moves issues, completes another and
starts the new one, and inventing a reversal for that would be worse than
admitting there isn't one.

**Approver policy, stated deliberately:** every applied action records an
approver so the trail can answer "who agreed to this". Undo is *not* gated on
matching it, because a local-first product with no accounts has no second
identity to check. There is a test that says so, and it is the test that should
start failing if accounts ever arrive.

### Priority 3 — the test gap, closed

Deterministic routes were gated on `provider.constructor.name === "OllamaProvider"`,
so no double could reach them: the paths that matter most on this hardware were
the least covered. The capability is now declared by the provider.

`OllamaShapedProvider` answers in the shapes a real Ollama returns — a native
call, a call printed into message text, or plain prose — and recovers printed
calls through the shipped `parseInlineToolCalls` rather than a lookalike. The
older `ScriptedProvider` hands the server a clean `ToolCall`, which skips every
layer where small models actually go wrong.

Five routes now covered over HTTP, each asserting the model was consulted zero
times.

### Priority 4 — multi-step

Compound requests are split deterministically on instruction-joining
conjunctions, capped at three steps, and each step runs through the whole
pipeline with the previous steps' results named explicitly. Not solved by better
prompting, per the brief: a 2GB VRAM ceiling is not a prompt problem.

A second clause only counts as a step if it reads as an instruction, so "create
a task and then we can discuss it" stays one request.

**A regression an existing test caught:** the combined response first took its
status from whichever step ran last, so a turn that queued work for approval
reported `done` and pointed at no run — leaving the queued actions
unapprovable. Status and run id now come from the steps that actually queued
something, and a turn producing more than one pending run says so rather than
silently orphaning one.

### Sweep sections B and E2 — now runnable, and run

| # | Case | Result | Test |
|---|---|---|---|
| B1 | Manual edit then undo | PASS | `refuses when the target was edited by hand after the run` |
| B2 | Undo twice | PASS | `refuses a second undo of the same run` |
| B3 | Target deleted | PASS | `reports plainly when the target no longer exists` |
| B4 | Partial reversibility | PASS | `reverses every action or none of them` |
| B5 | No defined reversal | PASS | `rejects a run containing an action with no defined reversal` |
| B6 | Approver policy | PASS (deliberate) | `records who approved, and does not gate undo on identity` |
| E2 | HTTP tests for deterministic routes | PASS | `deterministic routes answer without consulting the model` |

### Still open, graded

Two of the five turned out to be mis-stated. Graded as **blocking** (wrong
output a user would act on) or **polish** (missing output, or a limit that is
stated honestly).

| # | Item | Grade | Status |
|---|---|---|---|
| 1 | Commits on a branch never checked out were invisible | **was blocking** | **Fixed** — the scan reads `--branches`, not just HEAD |
| 2 | `hasCodeLinkWithSubject` collapses two commits sharing a subject | polish | **Fixed** — author date disambiguates |
| 3 | `CommitWatcher` has no automated test | polish | **Fixed** — 10 tests behind a VS Code stub |
| 4 | "Undo covers single-issue-row tools only" | **mis-stated** | Corrected below |
| 5 | Latency and model accuracy | not a defect | The product's constraint |

**#1 was blocking, and is fixed.** `git log` reads HEAD, so a week of work on a
feature branch that was not currently checked out simply did not exist as far as
NEMO was concerned — and the failure was not a missing signal but a false one:
the risk engine would report "in progress with no commits" for an issue somebody
had been writing code for all week. A missing signal is survivable; a
confidently wrong one is what makes a tool untrustworthy. The scan now covers
every local branch. Two original tests had encoded the HEAD-only behaviour and
were updated deliberately, not worked around.

**#4 was wrong in the doc, not in the code.** Verified with tests rather than
reasoning:

- A commit naming two issues produces **two separate actions** in one run, each
  with its own target row, and undo reverses **both**. There is no silent
  partial revert, and no asymmetry between what A1 records and what undo can
  return.
- A single action that touches many rows — `createSubtasks` creating N issues in
  one call — is refused with `NO_REVERSAL` before anything is touched. Both
  subtasks survive intact.

So the accurate statement is: undo reverses any number of actions whose effect
is one issue row each, and explicitly refuses actions whose single call touched
several rows. That refusal is the same deliberate choice as `planSprint`.

**#2 is polish** because its failure direction is safe: it can only ever produce
*one fewer* proposal, never a wrong one. Under-proposing is recoverable by
asking; over-acting is not.

**#3 is polish** because the watcher is roughly seventy lines of VS Code glue
over an endpoint that is covered end to end. What it can get wrong is failing to
fire, which is visible immediately in use.

**#5 is not a defect.** 20–130s per model-decided turn is the 2GB VRAM ceiling,
and no software change in this phase moves it. More VRAM is a 10–30× change.

---

## 11. Closing the list

### #2 — telling a rewritten commit from a repeated one

Deduplicating on subject alone was too blunt: two genuinely different commits
reusing a message on one issue collapsed into a single link, and the second was
never proposed. The author date separates them, and it is the right key because
**git preserves it through both amend and rebase** — a rewritten commit keeps
the identity it had, while a commit written later does not inherit somebody
else's.

Both directions are pinned: A5 (an amend is not re-proposed) and A5b (two
distinct commits sharing a subject are both linked).

The residual case is two commits sharing a subject *and* an author date, which
means the same second. If that happens the second is swallowed — but it now
requires a coincidence rather than merely reusing a message.

### #3 — the extension is no longer untested

`vscode` is provided by the editor and does not exist on disk, which is why
none of the extension had tests. A small stub of the API surface the extension
actually touches, aliased in a vitest config, is the seam that makes it testable
at all. The stub is deliberately minimal: a faithful reimplementation of VS Code
would be its own source of bugs.

Ten tests now cover what the watcher can get wrong silently — watching the
wrong path, firing once per HEAD movement during a rebase, reporting with no
project connected, throwing at a developer who was only committing, stacking
watchers when the folder changes, and leaving a pending report armed after
disposal.

**No part of the system is now without automated tests.**

### Confirmed explicitly: the audit trail and multi-issue commits

Asserted rather than inferred. A commit naming two issues produces **two action
rows**, with distinct target ids, each carrying its own before/after snapshot,
each independently reversible. Had they collapsed into one row, undo would have
reversed one issue and left the other — the original A1 bug reappearing at the
far end of the pipeline, and invisible until somebody undid a run and found half
of it still applied.

### Deliberate scope limits — not defects, do not "fix"

- Undo covers the last applied run only, not point-in-time restore.
- Multi-step decomposition is capped at three steps.
- The approver is recorded but not enforced; the tripwire test is intentional.
- Actions whose single call touches many rows refuse reversal by design.

### Outside this phase's reach

Latency and model accuracy: 20–130s per model-decided turn is the 2GB VRAM
ceiling. Confirmed by measurement across three models, unchanged by any software
work here.
