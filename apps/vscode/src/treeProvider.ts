import * as vscode from "vscode";
import type { Issue, Project, ProjectState } from "@ai-pm/shared";
import { api } from "./api.js";
import { SelectionState } from "./state.js";

const STATUS_LABELS: Record<string, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
};

interface Cache {
  project: Project | null;
  issue: Issue | null;
  state: ProjectState | null;
  myTasks: Issue[];
}

const EMPTY_CACHE: Cache = { project: null, issue: null, state: null, myTasks: [] };

function header(text: string): vscode.TreeItem {
  const item = new vscode.TreeItem(text, vscode.TreeItemCollapsibleState.None);
  item.contextValue = "aiPmHeader";
  return item;
}

function valueItem(label: string, description?: string, icon?: string): vscode.TreeItem {
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
  if (description) item.description = description;
  if (icon) item.iconPath = new vscode.ThemeIcon(icon);
  return item;
}

function taskItem(issue: Issue, isCurrent: boolean): vscode.TreeItem {
  const item = new vscode.TreeItem(`${issue.key}  ${issue.title}`, vscode.TreeItemCollapsibleState.None);
  item.description = STATUS_LABELS[issue.status] ?? issue.status;
  item.iconPath = new vscode.ThemeIcon(
    isCurrent ? "target" : issue.status === "in_progress" ? "circle-filled" : "circle-outline",
  );
  item.command = { command: "aiPm.selectTaskFromTree", title: "Set as current task", arguments: [issue.id] };
  item.tooltip = "Click to set as your current task";
  return item;
}

export class AiPmTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  private cache: Cache = EMPTY_CACHE;
  private errorMessage: string | null = null;
  private loading = false;

  constructor(private selection: SelectionState) {}

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (element) return []; // Intentionally flat -- reads like the product's own sidebar mockup.
    return this.buildItems();
  }

  async refresh(): Promise<void> {
    this.loading = true;
    this.errorMessage = null;
    this.emitter.fire();

    const projectId = this.selection.projectId;
    if (!projectId) {
      this.cache = EMPTY_CACHE;
      this.loading = false;
      this.emitter.fire();
      return;
    }

    try {
      const [project, state, allIssues] = await Promise.all([
        api.getProject(projectId),
        api.getProjectState(projectId),
        api.listIssues(projectId),
      ]);

      const issueId = this.selection.issueId;
      const issue = issueId ? (allIssues.find((i) => i.id === issueId) ?? null) : null;

      const myTasks = state.sprint
        ? allIssues.filter((i) => i.sprintId === state.sprint!.id && i.status !== "done")
        : allIssues.filter((i) => i.status !== "done");
      myTasks.sort((a, b) => {
        const order: Record<string, number> = { in_progress: 0, in_review: 1, todo: 2, backlog: 3 };
        return (order[a.status] ?? 9) - (order[b.status] ?? 9);
      });

      this.cache = { project, issue, state, myTasks };
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      this.loading = false;
      this.emitter.fire();
    }
  }

  private buildItems(): vscode.TreeItem[] {
    if (!this.selection.projectId) {
      const item = new vscode.TreeItem("No project connected", vscode.TreeItemCollapsibleState.None);
      item.command = { command: "aiPm.connectProject", title: "Connect Project" };
      item.iconPath = new vscode.ThemeIcon("plug");
      return [item];
    }

    if (this.loading && !this.cache.project) {
      return [valueItem("Loading…")];
    }

    if (this.errorMessage) {
      const item = valueItem("Couldn't reach the API", this.errorMessage, "warning");
      item.tooltip = this.errorMessage;
      return [item];
    }

    const { project, issue, state, myTasks } = this.cache;
    if (!project || !state) return [valueItem("Loading…")];

    const items: vscode.TreeItem[] = [];

    items.push(header("PROJECT"));
    const projectItem = valueItem(project.name, project.key);
    projectItem.command = { command: "aiPm.connectProject", title: "Switch project" };
    projectItem.tooltip = "Click to switch to another project";
    items.push(projectItem);

    items.push(header("CURRENT TASK"));
    items.push(
      issue
        ? valueItem(`${issue.key}  ${issue.title}`, STATUS_LABELS[issue.status] ?? issue.status, "target")
        : valueItem("No task selected", "Run “AI PM: Select Current Task”"),
    );

    items.push(header("SPRINT"));
    items.push(
      state.sprint
        ? valueItem(state.sprint.name, `${state.metrics.completedPoints} / ${state.metrics.totalPoints} pts`)
        : valueItem("No active sprint"),
    );

    items.push(header("RISKS"));
    if (state.risks.length === 0) {
      items.push(valueItem("No open risks"));
    } else {
      const counts = { high: 0, medium: 0, low: 0 };
      for (const r of state.risks) counts[r.severity as keyof typeof counts]++;
      if (counts.high > 0) items.push(valueItem(`${counts.high} High`, undefined, "error"));
      if (counts.medium > 0) items.push(valueItem(`${counts.medium} Medium`, undefined, "warning"));
      if (counts.low > 0) items.push(valueItem(`${counts.low} Low`, undefined, "info"));
    }

    items.push(header("MY TASKS"));
    if (myTasks.length === 0) {
      items.push(valueItem("Nothing in the active sprint"));
    } else {
      for (const t of myTasks) items.push(taskItem(t, t.id === issue?.id));
    }

    return items;
  }
}
