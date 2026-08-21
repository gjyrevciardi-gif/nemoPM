import * as vscode from "vscode";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CodeContext, CodeDiagnostic } from "@ai-pm/shared";

const execFileAsync = promisify(execFile);

/**
 * Editor context for the agent: what the user is looking at, not what is in
 * their repository.
 *
 * Two rules shape everything here. Nothing sensitive or generated leaves the
 * machine -- the same deny list the server enforces is applied before anything
 * is read, so a secret is never even loaded. And nothing large is sent: a
 * selection, a handful of diagnostics, a branch name, a file-count summary.
 * The server re-checks and re-bounds all of it; this is the first of two gates,
 * not the only one.
 */
const DENIED_PATH_PATTERNS: RegExp[] = [
  /(^|[\\/])\.env(\.|$)/i,
  /(^|[\\/])\.git([\\/]|$)/i,
  /(^|[\\/])node_modules([\\/]|$)/i,
  /(^|[\\/])(dist|build|out|coverage)([\\/]|$)/i,
  /(^|[\\/])(id_rsa|id_dsa|id_ecdsa|id_ed25519)(\.|$)/i,
  /\.(pem|key|pfx|p12|keystore|jks)$/i,
  /(^|[\\/])(secrets?|credentials?)([\\/.]|$)/i,
  /\.(png|jpe?g|gif|pdf|zip|tar|gz|exe|dll|so|dylib)$/i,
];

const MAX_SELECTION_CHARS = 4000;
const MAX_DIAGNOSTICS = 10;
const MAX_LISTED_FILES = 8;
const GIT_TIMEOUT_MS = 4000;

/**
 * Words that make a request depend on the editor. "Create a bug for this" is
 * meaningless without the selection; "list my sprint" is not, and sending code
 * for it would just be noise in the prompt.
 */
const DEICTIC = /\b(this|these|that|here|it)\b|\bselect(ed|ion)?\b|\bcurrent file\b|\bthis (file|function|error|change|code|line|bug)\b|\bthe error\b|\bmy change(s)?\b|\bdiff\b/i;

export function isSafeWorkspacePath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/").trim();
  if (!normalized) return false;
  if (normalized.startsWith("/") || /^[a-z]:\//i.test(normalized)) return false;
  if (normalized.split("/").includes("..")) return false;
  return !DENIED_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

function toRelativePath(uri: vscode.Uri): string | null {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) return null;
  // asRelativePath keeps it workspace-relative, so no absolute local path
  // (which leaks a username and a machine layout) ever leaves the extension.
  const relative = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, "/");
  return isSafeWorkspacePath(relative) ? relative : null;
}

async function git(args: string[], cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, timeout: GIT_TIMEOUT_MS });
    return stdout.trim();
  } catch {
    return null;
  }
}

/** "4 files changed (src/a.ts, src/b.ts, …)" -- never the diff content itself. */
async function summarizeWorkingTree(cwd: string): Promise<string | null> {
  const status = await git(["status", "--porcelain=v1"], cwd);
  if (status === null) return null;

  const files = status
    .split("\n")
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    .filter((file) => isSafeWorkspacePath(file));

  if (files.length === 0) return "working tree clean";
  const listed = files.slice(0, MAX_LISTED_FILES);
  const suffix = files.length > listed.length ? `, +${files.length - listed.length} more` : "";
  return `${files.length} file(s) changed (${listed.join(", ")}${suffix})`;
}

function collectDiagnostics(uri: vscode.Uri, relativePath: string): CodeDiagnostic[] {
  return vscode.languages
    .getDiagnostics(uri)
    .filter(
      (d) =>
        d.severity === vscode.DiagnosticSeverity.Error || d.severity === vscode.DiagnosticSeverity.Warning,
    )
    .slice(0, MAX_DIAGNOSTICS)
    .map((d) => ({
      path: relativePath,
      line: d.range.start.line + 1,
      severity: d.severity === vscode.DiagnosticSeverity.Error ? ("error" as const) : ("warning" as const),
      message: d.message.slice(0, 500),
      source: d.source ?? null,
    }));
}

/**
 * Whether this message needs editor context at all. A selection is a strong
 * signal on its own; otherwise the message has to actually refer to something
 * in the editor. Large context on every message would make every reply slower
 * and every prompt noisier.
 */
export function shouldAttachContext(message: string): boolean {
  const editor = vscode.window.activeTextEditor;
  const hasSelection = Boolean(editor && !editor.selection.isEmpty);
  return hasSelection || DEICTIC.test(message);
}

export async function buildCodeContext(message: string): Promise<CodeContext | null> {
  if (!shouldAttachContext(message)) return null;

  const editor = vscode.window.activeTextEditor;
  const folder = vscode.workspace.workspaceFolders?.[0];

  let activeFile: CodeContext["activeFile"] = null;
  let selection: CodeContext["selection"] = null;
  let diagnostics: CodeDiagnostic[] = [];

  if (editor) {
    const relativePath = toRelativePath(editor.document.uri);
    if (relativePath) {
      activeFile = { path: relativePath, languageId: editor.document.languageId };
      diagnostics = collectDiagnostics(editor.document.uri, relativePath);

      if (!editor.selection.isEmpty) {
        const text = editor.document.getText(editor.selection);
        selection = {
          path: relativePath,
          languageId: editor.document.languageId,
          startLine: editor.selection.start.line + 1,
          endLine: editor.selection.end.line + 1,
          text: text.slice(0, MAX_SELECTION_CHARS),
        };
      }
    }
  }

  const cwd = folder?.uri.fsPath;
  const branch = cwd ? await git(["rev-parse", "--abbrev-ref", "HEAD"], cwd) : null;
  const workingTree = cwd ? await summarizeWorkingTree(cwd) : null;

  const context: CodeContext = {
    activeFile,
    selection,
    diagnostics,
    branch: branch && branch !== "HEAD" ? branch : null,
    workingTree,
    relatedFiles: [],
  };

  const empty =
    !context.activeFile &&
    !context.selection &&
    context.diagnostics.length === 0 &&
    !context.branch &&
    !context.workingTree;

  return empty ? null : context;
}
