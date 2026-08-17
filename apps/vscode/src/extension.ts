import * as vscode from "vscode";
import type { IssueType, PlanTaskResponse, ProjectState } from "@ai-pm/shared";
import { api, ApiClientError } from "./api.js";
import { SelectionState } from "./state.js";
import { AiPmTreeProvider } from "./treeProvider.js";
import { AiPmChatPanel, AiPmChatViewProvider, ChatController } from "./chatProvider.js";
import { LiveSync } from "./liveSync.js";

/** Long enough to fold a burst of writes (an agent run, a board reorder) into one refresh. */
const REFRESH_DEBOUNCE_MS = 200;

let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  const selection = new SelectionState(context);
  const treeProvider = new AiPmTreeProvider(selection);
  // When the agent changes the project from chat, the tree view and status
  // bar must reflect it without the user manually hitting Refresh.
  const chatController = new ChatController(
    selection,
    () => {
      void treeProvider.refresh();
      void updateStatusBar(selection);
    },
    async () => {
      await vscode.commands.executeCommand("aiPm.connectProject");
    },
  );
  const chatProvider = new AiPmChatViewProvider(chatController);
  outputChannel = vscode.window.createOutputChannel("AI PM Status");

  vscode.window.registerTreeDataProvider("aiPm.sidebar", treeProvider);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("aiPm.chat", chatProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = "aiPm.projectStatus";
  context.subscriptions.push(statusBarItem);

  async function refreshAll() {
    await treeProvider.refresh();
    await updateStatusBar(selection);
    await chatProvider.refreshHeader();
    await AiPmChatPanel.refreshHeader();
  }

  let refreshTimer: NodeJS.Timeout | undefined;
  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void refreshAll(), REFRESH_DEBOUNCE_MS);
  }

  // Anything written elsewhere -- the web app, another window, the agent --
  // arrives here and updates the tree, status bar, and chat header on its own.
  const liveSync = new LiveSync((event) => {
    if (event.projectId && event.projectId !== selection.projectId) return;
    scheduleRefresh();
  });
  liveSync.start();
  context.subscriptions.push(liveSync, {
    dispose: () => {
      if (refreshTimer) clearTimeout(refreshTimer);
    },
  });

  async function requireProjectId(): Promise<string | undefined> {
    const id = selection.projectId;
    if (!id) {
      const choice = await vscode.window.showWarningMessage(
        "No project connected yet.",
        "Connect Project",
      );
      if (choice === "Connect Project") await vscode.commands.executeCommand("aiPm.connectProject");
      return undefined;
    }
    return id;
  }

  async function requireIssueId(): Promise<{ projectId: string; issueId: string } | undefined> {
    const projectId = await requireProjectId();
    if (!projectId) return undefined;
    const issueId = selection.issueId;
    if (!issueId) {
      const choice = await vscode.window.showWarningMessage(
        "No current task selected.",
        "Select Current Task",
      );
      if (choice === "Select Current Task") await vscode.commands.executeCommand("aiPm.selectCurrentTask");
      return undefined;
    }
    return { projectId, issueId };
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("aiPm.openChat", () => {
      AiPmChatPanel.open(chatController);
    }),

    vscode.commands.registerCommand("aiPm.refresh", async () => {
      await refreshAll();
    }),

    vscode.commands.registerCommand("aiPm.disconnectProject", async () => {
      if (!selection.projectId) {
        vscode.window.showInformationMessage("AI PM: this workspace isn't connected to a project.");
        return;
      }
      await selection.setProject(undefined);
      vscode.window.showInformationMessage(
        "AI PM: disconnected. Click the project name in the chat panel to link a different one.",
      );
      await refreshAll();
    }),

    vscode.commands.registerCommand("aiPm.connectProject", async () => {
      let projects;
      try {
        projects = await api.listProjects();
      } catch (err) {
        showApiError(err);
        return;
      }
      if (projects.length === 0) {
        vscode.window.showInformationMessage(
          "No projects exist yet. Create one from the web app at http://localhost:5174, then connect it here.",
        );
        return;
      }

      const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const currentId = selection.projectId;
      const items = [...projects]
        .sort((a, b) => {
          const aMatch = a.repositoryPath === workspaceFolder ? 0 : 1;
          const bMatch = b.repositoryPath === workspaceFolder ? 0 : 1;
          return aMatch - bMatch;
        })
        .map((p) => ({
          label: `${p.id === currentId ? "$(check) " : "$(circle-outline) "}${p.key}  ${p.name}`,
          description:
            p.id === currentId
              ? "connected"
              : p.repositoryPath === workspaceFolder
                ? "this workspace"
                : p.repositoryPath ?? "",
          project: p,
        }));

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: currentId ? "Switch to another project" : "Select a project to connect",
      });
      if (!picked) return;
      // Re-picking the same project shouldn't throw away the current task.
      if (picked.project.id === currentId) return;

      await selection.setProject(picked.project.id);

      // Try to match the repository path to the open workspace automatically.
      if (workspaceFolder && picked.project.repositoryPath !== workspaceFolder) {
        try {
          await api.updateProject(picked.project.id, { repositoryPath: workspaceFolder });
        } catch {
          // Non-fatal -- the project is still connected, just without an auto-linked repo path.
        }
      }

      vscode.window.showInformationMessage(`AI PM: connected to ${picked.project.name}.`);
      await refreshAll();
    }),

    vscode.commands.registerCommand("aiPm.selectCurrentTask", async () => {
      const projectId = await requireProjectId();
      if (!projectId) return;

      let issues;
      try {
        issues = await api.listIssues(projectId);
      } catch (err) {
        showApiError(err);
        return;
      }
      if (issues.length === 0) {
        vscode.window.showInformationMessage("This project has no issues yet. Run “AI PM: Create Task” first.");
        return;
      }

      const sorted = [...issues].sort((a, b) => (a.status === "done" ? 1 : 0) - (b.status === "done" ? 1 : 0));
      const items = sorted.map((i) => ({
        label: `${i.key}  ${i.title}`,
        description: i.status,
        issue: i,
      }));
      const picked = await vscode.window.showQuickPick(items, { placeHolder: "Select your current task" });
      if (!picked) return;

      await selection.setIssue(picked.issue.id);
      vscode.window.showInformationMessage(`Current task: ${picked.issue.key} ${picked.issue.title}`);
      await refreshAll();
    }),

    vscode.commands.registerCommand("aiPm.selectTaskFromTree", async (issueId: string) => {
      await selection.setIssue(issueId);
      await refreshAll();
    }),

    vscode.commands.registerCommand("aiPm.startCurrentTask", async () => {
      const ctx = await requireIssueId();
      if (!ctx) return;
      try {
        const issue = await api.startIssue(ctx.issueId);
        vscode.window.showInformationMessage(`${issue.key} started (In Progress).`);
      } catch (err) {
        showApiError(err);
      }
      await refreshAll();
    }),

    vscode.commands.registerCommand("aiPm.reviewCurrentTask", async () => {
      const ctx = await requireIssueId();
      if (!ctx) return;
      try {
        const issue = await api.reviewIssue(ctx.issueId);
        vscode.window.showInformationMessage(`${issue.key} moved to In Review.`);
      } catch (err) {
        showApiError(err);
      }
      await refreshAll();
    }),

    vscode.commands.registerCommand("aiPm.completeCurrentTask", async () => {
      const ctx = await requireIssueId();
      if (!ctx) return;
      try {
        const issue = await api.completeIssue(ctx.issueId);
        vscode.window.showInformationMessage(`${issue.key} marked Done.`);
      } catch (err) {
        showApiError(err);
      }
      await refreshAll();
    }),

    vscode.commands.registerCommand("aiPm.createTask", async () => {
      const projectId = await requireProjectId();
      if (!projectId) return;

      const title = await vscode.window.showInputBox({ prompt: "Task title", ignoreFocusOut: true });
      if (!title?.trim()) return;

      const type = await vscode.window.showQuickPick(["task", "story", "bug", "epic", "subtask"], {
        placeHolder: "Type (default: task)",
      });

      try {
        const issue = await api.createIssue({
          projectId,
          title: title.trim(),
          type: (type as IssueType | undefined) ?? "task",
          status: "backlog",
          priority: "medium",
        });
        vscode.window.showInformationMessage(`Created ${issue.key}: ${issue.title}`);
      } catch (err) {
        showApiError(err);
      }
      await refreshAll();
    }),

    vscode.commands.registerCommand("aiPm.scanGitActivity", async () => {
      const projectId = await requireProjectId();
      if (!projectId) return;
      try {
        const result = await api.scanGit(projectId);
        vscode.window.showInformationMessage(
          `Git scan complete: ${result.newCommitsDetected} new commit(s) detected` +
            (result.branchChanged ? " (branch changed)." : "."),
        );
      } catch (err) {
        showApiError(err);
      }
      await refreshAll();
    }),

    vscode.commands.registerCommand("aiPm.projectStatus", async () => {
      const projectId = await requireProjectId();
      if (!projectId) return;
      outputChannel.clear();
      outputChannel.appendLine("Fetching AI PM status…");
      outputChannel.show(true);
      try {
        const result = await api.getAiStatus(projectId);
        outputChannel.clear();
        outputChannel.appendLine(
          result.source === "ai" ? `(via ${result.model ?? "local model"})\n` : "(offline summary -- Ollama unavailable)\n",
        );
        outputChannel.appendLine(result.text);
      } catch (err) {
        outputChannel.clear();
        outputChannel.appendLine(err instanceof ApiClientError ? err.message : String(err));
        showApiError(err);
      }
    }),

    vscode.commands.registerCommand("aiPm.askAiPm", async () => {
      const projectId = await requireProjectId();
      if (!projectId) return;

      const requestText = await vscode.window.showInputBox({
        prompt: "What do you want AI PM to do?",
        placeHolder: "e.g. organize my sprint, plan the login page, add tasks for password reset",
        ignoreFocusOut: true,
      });
      if (!requestText?.trim()) return;

      let plan: PlanTaskResponse;
      let state: ProjectState;
      try {
        [plan, state] = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: "AI PM is planning…", cancellable: false },
          () => Promise.all([api.planTask(projectId, requestText.trim()), api.getProjectState(projectId)]),
        );
      } catch (err) {
        showApiError(err);
        return;
      }

      outputChannel.clear();
      outputChannel.appendLine(`AI PM plan: ${plan.feature}`);
      outputChannel.appendLine(plan.summary);
      outputChannel.appendLine("");
      outputChannel.appendLine("Tasks:");
      for (const t of plan.tasks) {
        outputChannel.appendLine(`  [${t.type}] ${t.title} — ${t.storyPoints} pts, ${t.priority} priority`);
      }
      if (plan.risks.length > 0) {
        outputChannel.appendLine("\nRisks:");
        for (const r of plan.risks) outputChannel.appendLine(`  - ${r}`);
      }
      if (plan.dependencies.length > 0) {
        outputChannel.appendLine("\nDependencies:");
        for (const d of plan.dependencies) outputChannel.appendLine(`  - ${d}`);
      }
      outputChannel.show(true);

      const willStartSprint = !state.sprint;
      const confirmLabel = willStartSprint ? "Create Tasks & Start Sprint" : `Add to “${state.sprint!.name}”`;
      const choice = await vscode.window.showInformationMessage(
        `AI PM plans ${plan.tasks.length} task(s) for “${plan.feature}” — see the AI PM Status output panel for details.`,
        { modal: true },
        confirmLabel,
      );
      if (choice !== confirmLabel) return;

      try {
        // Sprint-assignment (use the active sprint, or create+start one named
        // after the feature) is decided server-side by confirmPlanTask, so
        // this no longer duplicates that decision client-side.
        const created = await api.confirmPlan(projectId, {
          autoSprint: true,
          feature: plan.feature,
          tasks: plan.tasks,
        });
        vscode.window.showInformationMessage(
          `AI PM created ${created.length} task(s)${willStartSprint ? ` and started sprint “${plan.feature}”` : ""}. ` +
            `Open http://localhost:5174 to see the board.`,
        );
      } catch (err) {
        showApiError(err);
      }
      await refreshAll();
    }),
  );

  refreshAll();
}

function showApiError(err: unknown) {
  const message = err instanceof ApiClientError ? err.message : err instanceof Error ? err.message : String(err);
  vscode.window.showErrorMessage(`AI PM: ${message}`);
}

async function updateStatusBar(selection: SelectionState) {
  if (!selection.projectId) {
    statusBarItem.text = "$(plug) AI PM: not connected";
    statusBarItem.show();
    return;
  }
  try {
    const project = await api.getProject(selection.projectId);
    if (selection.issueId) {
      const issue = await api.getIssue(selection.issueId);
      statusBarItem.text = `$(target) ${project.key} · ${issue.key}`;
      statusBarItem.tooltip = issue.title;
    } else {
      statusBarItem.text = `$(project) ${project.key} · no task selected`;
    }
  } catch {
    statusBarItem.text = "$(warning) AI PM: API unreachable";
  }
  statusBarItem.show();
}

export function deactivate() {
  outputChannel?.dispose();
  statusBarItem?.dispose();
}
