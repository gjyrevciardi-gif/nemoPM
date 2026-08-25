# AI PM

A local-first, single-user AI project manager for developers. It combines a Trello/Jira-style
board, basic Scrum, a VS Code extension, local Git awareness, and an AI PM assistant that gives
evidence-based status and risk summaries -- grounded in a deterministic state engine, never in
vibes.

The core idea: **you work mainly inside VS Code, and the system keeps enough project context
updated automatically to act like a PM** -- without surveillance, without inventing facts, and
without silently completing your work for you.

## Product overview

- **Board & backlog** -- epics/stories/tasks/bugs/subtasks across Backlog -> Todo -> In Progress ->
  In Review -> Done, with drag-and-drop, dependencies, and story points.
- **Sprints** -- create, start, and complete sprints; sprint-scoped progress metrics.
- **Git intelligence** -- reads a connected local repository across every local branch: commits,
  branch activity, and the issue keys named in commit messages. Commits are linked as *evidence*
  to the issues they name (or, for a plain scan, to whichever issue is in progress), and a commit
  naming an issue produces a *proposed* move to review. Git activity never changes issue status on
  its own -- a proposal waits for approval, and only an explicit Start/Review/Complete action or an
  approved proposal moves anything.
- **Deterministic risk engine** -- five rules: stale task, blocked dependency and sprint overload
  from the database, plus no-commits and abandoned-branch from the repository. Each risk carries
  concrete evidence, not a vibe.
- **AI PM** -- asks a local Ollama model for a concise status/risk summary built from the
  deterministic state (not raw DB dumps), and falls back to a fully deterministic summary if
  Ollama is offline, times out, or returns garbage. The app never crashes or hangs because the AI
  is unavailable.
- **AI task planning** -- turns a feature request into a previewable task breakdown; nothing is
  saved until you explicitly confirm.
- **Agent turns** -- ask for something in plain language and the model picks tools rather than
  writing prose about them. Every tool sits in one of three permission tiers, enforced on the
  server where the model cannot see them: reads and low-risk writes run immediately, anything
  consequential is described and queued for you to approve, and a few things (deleting a project,
  bulk deletes) are never callable at all. Approving a run applies all of its actions or none.
  A compound request is split into at most three steps and run in order.
- **Undo** -- applying a run records what each action touched, before and after, and who approved
  it. `agent/undo` reverses the last applied run in one transaction. It refuses, by name and
  before touching anything, when an action has no defined inverse, when someone edited the target
  since, when the target is gone, or when the run was already undone -- a run that cannot be fully
  reversed is not partly reversed.
- **VS Code extension** -- a sidebar showing your project/current task/sprint/risks, a chat panel,
  and commands to connect or disconnect a project, select/start/review/complete your current task,
  create tasks, scan Git activity, and get an AI status report -- all from the editor. It also
  watches for commits in the background and links them without being asked. **Ask AI PM** lets you
  type a free-form request ("organize my sprint", "plan the login page") and, after you confirm
  the generated plan, it creates the tasks and starts a sprint for them automatically -- the same
  generate-plan/confirm API the web app uses, just one step from the editor.

## Architecture

```
apps/
  api/      Fastify + Zod REST API (port 43821)
  web/      React + Vite + Tailwind board/dashboard (port 5174)
  vscode/   VS Code extension (sidebar + 12 commands, passive commit awareness)
packages/
  database/       SQLite (better-sqlite3) schema, migrations, repositories, seed script
  shared/         Zod schemas + inferred types shared by every app
  domain/         Tool registry, permission engine, domain operations (every write goes through it)
  project-state/  Deterministic Project State Engine + Risk Engine (pure functions, no I/O)
  git-context/    Read-only git reader: commits, branches, issue-key links (no writes, ever)
  ai/             AIProvider abstraction + OllamaProvider (safe-failure by design)
```

Data flows one way through the stack: **DB -> Project State Engine -> Risk Engine -> AI prompt /
API response.** The AI is never handed raw database rows -- it's handed a structured,
already-computed `ProjectState`. This keeps the app useful and honest even with the AI turned off.

### How the Project State Engine works

`packages/project-state` combines the project, its issues, the active sprint, dependency edges,
live Git status, and recent activity into one structured `ProjectState` object (see
`packages/shared/src/state.ts` for the exact shape). It's a pure function -- no database or network
access -- so it's fully unit-tested in isolation (`packages/project-state/test`).

### How Git tracking works

`apps/api/src/lib/git.ts` shells out to the local `git` CLI using `execFile` with an argv array
(never a shell string), so a repository path can never be interpreted as shell syntax. A scan
(`POST /projects/:id/git/scan`):

1. Reads the repository's current branch, working-tree status, and commits newer than the last
   scanned commit hash (stored per-repository).
2. Links each new commit -- with its changed files -- to whichever issue is currently `in_progress`,
   as `code_links` rows and `git.*` activity events.
3. **Never changes issue status.** Git activity is evidence for the risk engine and the AI, not
   project truth. Completing an issue always requires an explicit action (web board, API, or the
   "Complete Current Task" VS Code command).

Re-running a scan with no new commits is a no-op for commit/file-change events (only a summary
`git.scan` activity is recorded), so the activity feed doesn't get spammed.

A second, key-driven path (`POST /projects/:id/git/commits`) reads every local branch -- not just
the checked-out one, since work committed on a branch nobody has checked out again would otherwise
be invisible -- and links each commit to the issues its message names. Where an issue is somewhere
a commit is news, it queues a *proposed* move to `in_review` as an agent run awaiting approval.
The link is recorded whether or not the proposal is approved: what the repository says happened is
a fact, independent of whether you agree with the inference drawn from it. The VS Code extension
calls this endpoint automatically when it sees git move HEAD, which is what makes commit awareness
passive rather than a command you have to remember.

### How risk detection works

`packages/project-state/src/risk-engine.ts` implements three database-derived rules, each
documented with its exact threshold in code:

- **Stale task** -- an `in_progress` issue with no activity for more than 2 days (medium), escalating
  to high past 5 days.
- **Blocked dependency** -- issue A depends on issue B, B isn't done, and A is in the active sprint.
- **Sprint overload** -- compares the sprint's remaining story points against its observed
  completion pace (points completed so far divided by days elapsed); flags when, at that pace,
  finishing the remaining work would take significantly longer than the time already spent.

`packages/project-state/src/git-risk-engine.ts` adds two more, derived from the repository rather
than the board -- the board says what someone claimed, the repository says what was written:

- **No commits** -- an `in_progress` issue with no commit referencing it for more than 3 days.
- **Abandoned branch** -- an unmerged branch carrying an open issue with no commits for more than
  10 days. Merged branches are ignored however old they are: a merged branch is finished work.

Every risk carries an `evidence` array of concrete facts (statuses, timestamps, point counts) --
never a bare assertion. Risks are reconciled (opened/updated/resolved) each time project state is
computed, so completing the blocking issue automatically resolves the dependent risk.

## Prerequisites

- Node.js >= 18.17
- pnpm (`corepack enable` or `npm install -g pnpm`)
- Git
- (Optional, for real AI responses) [Ollama](https://ollama.com) running locally with at least one
  model pulled, e.g. `ollama pull llama3.1`. Without it, the app works fully -- AI status falls back
  to a deterministic summary, and AI task planning returns a clear "AI unavailable" error instead
  of fabricating tasks.
- (Optional) VS Code >= 1.85, to run the extension

## Installation

```bash
pnpm install
```

## Environment variables

Copy `.env.example` to `.env` at the repo root and adjust if needed (all values below are the
defaults used if `.env` is absent):

```env
DATABASE_PATH=./data/ai-pm.db
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=
OLLAMA_TIMEOUT_MS=120000
API_PORT=43821
```

`OLLAMA_MODEL` can be left blank -- the app auto-detects the first locally installed Ollama model.
`DATABASE_PATH` is resolved relative to the repo root regardless of which directory a script is
invoked from.

## Database setup & seed data

The SQLite database and its schema are created automatically (migrations run on first connection --
no separate `db:migrate` step). The same applies to an existing database: any migration it has not
seen is applied, in order, in a transaction, the next time the API connects. Nothing needs a fresh
database -- including `0010`, which rebuilds `code_links` in place because SQLite cannot drop a
table-level constraint. To populate the demo project:

```bash
pnpm seed
```

This creates project **Acme SaaS** (key `ACME`) with an active **Sprint 1** and six issues
(ACME-1 through ACME-6, matching the auth epic / login / dashboard / password recovery / billing /
token-refresh-bug set), including the dependency **ACME-4 depends on ACME-2**. Re-running `pnpm
seed` is a no-op if the project already exists; delete `data/ai-pm.db` for a truly fresh start.

## Running locally

```bash
pnpm dev
```

Starts the API (`http://127.0.0.1:43821`) and the web app (`http://localhost:5174`) together. Open
the web app, click into **Acme SaaS**, and use the Board / Backlog / Activity tabs.

## Ollama setup (optional, for real AI responses)

```bash
# Install from https://ollama.com, then:
ollama pull llama3.1
ollama serve   # usually already running as a background service after install
```

No further configuration needed -- the API auto-detects the model. If Ollama isn't running, "Ask AI
PM" still works and clearly labels its response as an offline summary; AI task planning returns a
503 with a clear message instead of a partial/fabricated plan.

## VS Code extension setup

The extension lives at `apps/vscode` and is developed/run independently of the `pnpm dev` web
workspace (this is the standard way to develop a VS Code extension):

1. In VS Code: **File -> Open Folder...** -> select `ai-pm/apps/vscode` (open it as its own folder,
   not as part of the monorepo root).
2. Run `pnpm install` at the **monorepo root** first if you haven't already (this links
   `apps/vscode`'s dependencies via the pnpm workspace).
3. Press **F5** (or Run -> Start Debugging). This builds the extension (`tsc`, via the preconfigured
   task in `.vscode/tasks.json`) and launches a new **Extension Development Host** window with "AI
   PM" installed.
4. In the Extension Development Host window, open the folder for the Git repo you want to track
   (any local repo works).
5. Click the **AI PM** icon in the Activity Bar (left sidebar). It starts disconnected.
6. Run **AI PM: Connect or Switch Project** from the Command Palette (Cmd/Ctrl+Shift+P) -- requires
   the API server to be running (`pnpm dev` in the monorepo root, in a separate terminal). Pick a
   project; if the currently open workspace folder matches it, or once you connect it, its path is
   saved as that project's `repositoryPath` automatically.
7. Run **AI PM: Select Current Task**, pick an issue.
8. Run **AI PM: Start Current Task** -- the sidebar and the web board both reflect the change.
9. Make a commit in the repo whose message names an issue key (e.g. "ACME-2 wire up login"). The
   extension notices HEAD move and links it on its own, about a second and a half later; a commit
   naming an issue offers to move it to review, and nothing happens unless you accept. **AI PM:
   Scan Git Activity** still exists for the older evidence-only scan, and to force a check.
10. Run **AI PM: Project Status** -- opens an output channel with a concise status (real AI or
    offline summary, clearly labeled).
11. Run **AI PM: Complete Current Task** -- refresh the web board; the issue is now in Done.
12. Run **AI PM: Ask AI PM** (also available as the speech-bubble icon in the sidebar title bar) --
    type a request like "organize my sprint" or "plan the password reset flow". AI PM asks the
    local model for a plan and shows it in the **AI PM Status** output panel (feature, tasks with
    points/priority, risks, dependencies). Confirm the modal prompt and it creates the tasks and --
    if no sprint is active yet -- creates and starts one for them, exactly like generating a plan and
    clicking Confirm in the web app, just in one step. Nothing is created until you confirm; if
    Ollama is offline the command fails clearly instead of inventing a plan.

All 12 commands are also reachable from the Command Palette by typing "AI PM". The API URL is
configurable via the `aiPm.apiUrl` setting (default `http://127.0.0.1:43821`).

## Environment variables reference

| Variable          | Default                    | Notes                                          |
|--------------------|-----------------------------|-------------------------------------------------|
| `DATABASE_PATH`    | `./data/ai-pm.db`           | Relative to repo root, or an absolute path      |
| `OLLAMA_BASE_URL`  | `http://127.0.0.1:11434`    | Ollama's local API                              |
| `OLLAMA_MODEL`     | *(blank -> auto-detect)*    | Pin a specific model name if you have several   |
| `OLLAMA_TIMEOUT_MS`| `120000`                    | Per-call timeout; raise it on slower hardware   |
| `API_PORT`         | `43821`                     | API server port                                 |
| `LOG_LEVEL`        | `info`                      | Fastify log level                               |

## API summary

All endpoints are on `http://127.0.0.1:43821`. Request/response bodies are validated with Zod
(`packages/shared`); errors return `{ "error": { "code": "...", "message": "..." } }`.

```
GET    /health

POST   /projects                              GET  /projects            GET /projects/:id
PATCH  /projects/:id                           DELETE /projects/:id

POST   /issues                                 GET  /projects/:projectId/issues
GET    /issues/:id      PATCH /issues/:id       DELETE /issues/:id
POST   /issues/:id/start | /review | /complete
POST   /issues/:id/dependencies                GET  /issues/:id/dependencies
DELETE /issues/:id/dependencies/:dependencyId
GET    /issues/:id/code-links                  (linked Git commits -- used by the issue detail view)

POST   /sprints                                GET  /projects/:projectId/sprints
POST   /sprints/:id/start                      POST /sprints/:id/complete

GET    /projects/:projectId/activity           (supports ?limit= and ?issueId=)

GET    /projects/:projectId/git/status         POST /projects/:projectId/git/scan
POST   /projects/:projectId/git/commits        (link commits by issue key; queues proposals)

GET    /projects/:projectId/state              (the full deterministic ProjectState)
GET    /projects/:projectId/risks

POST   /projects/:projectId/agent              { message: string }   (an agent turn)
POST   /projects/:projectId/agent/:runId/apply | /reject
GET    /projects/:projectId/agent/runs          GET /projects/:projectId/agent/runs/:runId
POST   /projects/:projectId/agent/undo         { runId?: string }   (reverses the last applied run)

POST   /projects/:projectId/ai/status          { question?: string }
POST   /projects/:projectId/ai/plan-task       { request: string }
POST   /projects/:projectId/ai/plan-task/confirm   (not in the original literal endpoint list --
                                                     added to close the spec's own "Generate plan ->
                                                     Preview -> Confirm creation" loop; creates
                                                     issues from a previewed plan only on explicit
                                                     confirmation)
```

## Known limitations

- **Single user, single machine, no auth** -- by design (see Scope). The web app and VS Code
  extension both assume they're talking to a `127.0.0.1` API only you can reach.
- **"Active issue" is inferred, not assigned** -- the dashboard's "Active task" and the AI's
  "current work" context are the most recently started `in_progress` issue, not a stored
  assignment. The VS Code extension's "current task" is a separate, per-workspace selection
  (stored in VS Code workspace state) used to target Start/Review/Complete commands -- the two
  concepts are related but intentionally decoupled.
- **Sprint overload thresholds are heuristic**, not a certified estimation model -- documented and
  adjustable in `packages/project-state/src/risk-engine.ts`.
- **`git/scan` is still pull-based** (you or the VS Code extension trigger it). Commit *linking*
  is not: the extension watches `.git/logs/HEAD` and calls `git/commits` on its own, so commits
  are linked and proposals raised without a command. It debounces 1.5s, because a rebase moves HEAD
  several times in a row and that is one event, not five. Outside VS Code, linking is still a call
  you make.
- **The VS Code extension uses global `fetch`** (no bundled HTTP dependency) -- requires a
  reasonably current VS Code (tested against the 1.85+ engine target; older Electron/Node versions
  inside VS Code may lack global `fetch`).
- **Board position persistence is best-effort**: dragging persists the moved card's new status and
  index; it doesn't re-persist every other card's index in the same operation. Fine at demo/small-
  project scale (this is a single-user local tool); would need a batch reorder endpoint at larger
  scale.
- **The extension's commands have no automated tests, and were never run in a live Extension
  Development Host** -- no VS Code GUI was available in the environment this was built in. Every
  API call they make was exercised end-to-end against the server, so the risk is confined to VS
  Code API usage specifics rather than request logic. The one piece with real tests is the commit
  watcher (`apps/vscode/test/`), which runs against a small stub of the editor API because
  `vscode` is provided by the editor and does not exist on disk; it was the piece worth testing
  first because what it gets wrong is silent.

## Future roadmap

1. Batch position/reorder endpoint for fully consistent board drag state.
2. Sprint burndown chart using the same deterministic metrics already computed.
3. Configurable risk thresholds via the `settings` table (schema already supports arbitrary
   key/value settings).
4. ~~Push-based Git awareness (file watcher / git hook) as an alternative to manual/command-driven
   scanning.~~ **Done** -- the extension watches `.git/logs/HEAD`. A git hook remains an option for
   people who do not work in VS Code.
5. Optional multi-machine sync for the same local-first project (e.g. a synced file), without
   introducing hosted accounts or multi-user concepts.
