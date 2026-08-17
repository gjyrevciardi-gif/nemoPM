import * as vscode from "vscode";

const PROJECT_KEY = "aiPm.projectId";
const ISSUE_KEY = "aiPm.issueId";

export class SelectionState {
  constructor(private context: vscode.ExtensionContext) {}

  get projectId(): string | undefined {
    return this.context.workspaceState.get<string>(PROJECT_KEY);
  }

  get issueId(): string | undefined {
    return this.context.workspaceState.get<string>(ISSUE_KEY);
  }

  async setProject(projectId: string | undefined) {
    await this.context.workspaceState.update(PROJECT_KEY, projectId);
    // Selecting a different project invalidates whatever task was current.
    await this.context.workspaceState.update(ISSUE_KEY, undefined);
  }

  async setIssue(issueId: string | undefined) {
    await this.context.workspaceState.update(ISSUE_KEY, issueId);
  }
}
