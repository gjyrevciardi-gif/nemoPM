import * as vscode from "vscode";
import { api, ApiClientError } from "./api.js";
import { SelectionState } from "./state.js";
import type { CodeContext } from "@ai-pm/shared";
import { getNonce, renderChatHtml } from "./chatUi.js";
import { buildCodeContext } from "./codeContext.js";

/**
 * Message plumbing between a chat webview and the agent API. Shared by both
 * surfaces the chat can live in -- the sidebar view and the large editor
 * panel -- so their behavior can't drift apart.
 *
 * Messages go to POST /projects/:id/agent, where the model can call real
 * project-management tools: AUTO-tier tools (create/update/move issues,
 * dependencies) execute immediately; ASK-tier tools (sprint planning,
 * deletions) come back as a proposal the user approves here, which then
 * calls /agent/:runId/apply.
 */
export class ChatController {
  constructor(
    private readonly selection: SelectionState,
    private readonly onDidMutate: () => void,
    private readonly onSwitchProject: () => Promise<void>,
  ) {}

  attach(webview: vscode.Webview): vscode.Disposable {
    return webview.onDidReceiveMessage(async (message: { type: string; text?: string; runId?: string }) => {
      if (message.type === "ready") {
        await this.sendHeader(webview);
      } else if (message.type === "send") {
        await this.handleSend(webview, String(message.text ?? ""));
      } else if (message.type === "apply") {
        await this.handleApply(webview, String(message.runId ?? ""));
      } else if (message.type === "reject") {
        await this.handleReject(webview, String(message.runId ?? ""));
      } else if (message.type === "switchProject") {
        // The picker refreshes every surface itself, this one included.
        await this.onSwitchProject();
      }
    });
  }

  async sendHeader(webview: vscode.Webview) {
    const projectId = this.selection.projectId;
    if (!projectId) {
      webview.postMessage({ type: "header", connected: false, projectId: null });
      return;
    }
    try {
      const [project, state] = await Promise.all([api.getProject(projectId), api.getProjectState(projectId)]);
      webview.postMessage({
        type: "header",
        connected: true,
        projectId,
        project: { name: project.name, key: project.key },
        sprint: state.sprint ? state.sprint.name : null,
        riskCount: state.risks.length,
        progress: `${state.metrics.completedIssues}/${state.metrics.totalIssues}`,
      });
    } catch {
      // Still connected -- the API just isn't answering. Reporting the real
      // projectId keeps the webview from mistaking this for a project switch
      // and wiping the transcript over a blip.
      webview.postMessage({ type: "header", connected: false, unreachable: true, projectId });
    }
  }

  private async handleSend(webview: vscode.Webview, text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;

    const projectId = this.selection.projectId;
    if (!projectId) {
      webview.postMessage({
        type: "assistant",
        role: "error",
        text: "No project connected yet. Click the project name at the top of this panel to pick one.",
      });
      return;
    }

    webview.postMessage({ type: "thinking", value: true });
    try {
      // Only requests that actually refer to the editor carry editor context:
      // "create a bug for this" needs the selection, "what's in my sprint"
      // does not, and sending code either way would just slow every turn down.
      const codeContext = await buildCodeContext(trimmed);
      if (codeContext) {
        webview.postMessage({ type: "context", summary: describeAttachedContext(codeContext) });
      }

      const result = await api.runAgent(projectId, trimmed, codeContext);
      webview.postMessage({
        type: "assistant",
        role: "assistant",
        text: result.reply,
        applied: result.appliedResults,
        actions: result.status === "proposed" ? result.actions : [],
        runId: result.runId,
      });
      if (result.appliedResults.length > 0) this.onDidMutate();
      await this.sendHeader(webview);
    } catch (err) {
      webview.postMessage({ type: "assistant", role: "error", text: errorText(err) });
    } finally {
      webview.postMessage({ type: "thinking", value: false });
    }
  }

  /**
   * Cancelling has to reach the server, not just clear the card: a proposal
   * left in "proposed" is a plan the audit trail says nobody ever decided on,
   * and it stays applicable until it expires.
   */
  private async handleReject(webview: vscode.Webview, runId: string) {
    const projectId = this.selection.projectId;
    if (!projectId || !runId) return;
    try {
      await api.rejectAgentRun(projectId, runId);
      webview.postMessage({ type: "rejected", runId });
    } catch (err) {
      webview.postMessage({ type: "assistant", role: "error", text: errorText(err) });
    }
  }

  private async handleApply(webview: vscode.Webview, runId: string) {
    const projectId = this.selection.projectId;
    if (!projectId || !runId) return;

    webview.postMessage({ type: "applying", runId, value: true });
    try {
      const result = await api.applyAgentRun(projectId, runId);
      webview.postMessage({ type: "applied", runId, status: result.status, results: result.results });
      this.onDidMutate();
      await this.sendHeader(webview);
    } catch (err) {
      webview.postMessage({ type: "assistant", role: "error", text: errorText(err) });
    } finally {
      webview.postMessage({ type: "applying", runId, value: false });
    }
  }
}

/** The chat as a sidebar view inside the AI PM activity-bar container. */
export class AiPmChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "aiPm.chat";
  private view?: vscode.WebviewView;

  constructor(private readonly controller: ChatController) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = renderChatHtml(getNonce(), "sidebar");
    this.controller.attach(webviewView.webview);
  }

  async refreshHeader() {
    if (this.view) await this.controller.sendHeader(this.view.webview);
  }
}

/**
 * The chat as a full editor-column panel. Opening it beside the active
 * editor gives the roomy right-hand-side layout the sidebar can't.
 */
export class AiPmChatPanel {
  private static current: AiPmChatPanel | undefined;

  static open(controller: ChatController) {
    const column = vscode.ViewColumn.Beside;
    if (AiPmChatPanel.current) {
      AiPmChatPanel.current.panel.reveal(column);
      return;
    }
    const panel = vscode.window.createWebviewPanel("aiPm.chatPanel", "Ask AI PM", column, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });
    AiPmChatPanel.current = new AiPmChatPanel(panel, controller);
  }

  static async refreshHeader() {
    const current = AiPmChatPanel.current;
    if (current) await current.controller.sendHeader(current.panel.webview);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly controller: ChatController,
  ) {
    panel.webview.html = renderChatHtml(getNonce(), "panel");
    const subscription = controller.attach(panel.webview);
    panel.onDidDispose(() => {
      subscription.dispose();
      AiPmChatPanel.current = undefined;
    });
  }
}

function errorText(err: unknown): string {
  if (err instanceof ApiClientError) return err.message;
  return err instanceof Error ? err.message : String(err);
}

/**
 * What the user is told was attached. Sending code silently would be the wrong
 * default: the chat should show exactly what left the editor.
 */
function describeAttachedContext(context: CodeContext): string {
  const parts: string[] = [];
  if (context.selection) {
    const lines = context.selection.endLine - context.selection.startLine + 1;
    parts.push(`${context.selection.path}:${context.selection.startLine} (${lines} line${lines === 1 ? "" : "s"})`);
  } else if (context.activeFile) {
    parts.push(context.activeFile.path);
  }
  if (context.diagnostics.length > 0) parts.push(`${context.diagnostics.length} problem(s)`);
  if (context.branch) parts.push(context.branch);
  return `Attached: ${parts.join(" · ")}`;
}
