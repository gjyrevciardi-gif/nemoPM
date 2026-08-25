import * as vscode from "vscode";
import * as path from "node:path";
import { api } from "./api.js";

/**
 * Watches the local repository for commits and tells NEMO, with no user action.
 *
 * `.git/logs/HEAD` gets one appended line per HEAD movement -- commit, checkout,
 * merge, rebase -- so watching it catches a commit made from the terminal, from
 * the VS Code UI, or from any other tool. Polling `git log` on a timer would be
 * the alternative and would spend CPU on a laptop that is already the bottleneck
 * for this product.
 *
 * The extension only ever *notifies*. Deciding what a commit means, and asking
 * for approval before acting on it, stays on the server where the permission
 * engine lives.
 */
export class CommitWatcher implements vscode.Disposable {
  private watcher: vscode.FileSystemWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;
  private disposed = false;

  /** HEAD moves several times during a rebase; one notification is enough. */
  private static readonly SETTLE_MS = 1500;

  constructor(
    private readonly getProjectId: () => string | null,
    private readonly onProposals: (proposed: number) => void,
    private readonly log: (message: string) => void,
  ) {}

  start(workspaceFolder: string | null): void {
    this.stop();
    if (this.disposed || !workspaceFolder) return;

    const pattern = new vscode.RelativePattern(workspaceFolder, path.join(".git", "logs", "HEAD"));
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);

    const onMoved = () => this.scheduleNotify();
    this.watcher.onDidChange(onMoved);
    this.watcher.onDidCreate(onMoved);

    this.log(`Watching for commits in ${workspaceFolder}`);
  }

  private scheduleNotify(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.notify(), CommitWatcher.SETTLE_MS);
  }

  private async notify(): Promise<void> {
    const projectId = this.getProjectId();
    if (!projectId) return;

    try {
      const result = await api.notifyCommits(projectId);
      if (result.linked > 0) {
        this.log(`Linked ${result.linked} commit(s); ${result.proposed.length} transition(s) proposed`);
      }
      if (result.proposed.length > 0) this.onProposals(result.proposed.length);
    } catch (err) {
      // A commit must never produce an error popup: the developer was committing,
      // not asking NEMO for anything.
      this.log(`Could not report commits: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.watcher?.dispose();
    this.watcher = null;
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
  }
}
