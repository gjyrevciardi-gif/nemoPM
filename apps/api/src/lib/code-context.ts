import type { CodeContext } from "@ai-pm/shared";

/**
 * Editor context arrives from a client and goes into a model prompt, so it is
 * treated as untrusted input on two axes: it must not leak secrets, and it
 * must not be large.
 *
 * The rule is deny-by-default on paths that are commonly sensitive or
 * generated, plus line-level redaction for anything that looks like a
 * credential even inside an allowed file.
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

/** Line-level redaction for credentials that live inside otherwise-fine files. */
const SECRET_LINE_PATTERNS: RegExp[] = [
  /(api[_-]?key|secret|password|passwd|token|bearer|authorization|private[_-]?key|client[_-]?secret)/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(sk|pk|ghp|gho|xox[baprs])[-_][A-Za-z0-9]{16,}\b/,
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/, // long base64-ish blobs
  /:\/\/[^\s:@/]+:[^\s@/]+@/, // credentials embedded in a URL
];

const MAX_SELECTION_CHARS = 4000;
const MAX_DIAGNOSTICS = 10;
const MAX_RELATED_FILES = 10;
const MAX_LINE_CHARS = 400;

export function isSafePath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").trim();
  if (!normalized) return false;
  // Only workspace-relative paths: an absolute path or a traversal is a
  // client trying to describe a file outside the project.
  if (normalized.startsWith("/") || /^[a-z]:\//i.test(normalized)) return false;
  if (normalized.split("/").includes("..")) return false;
  return !DENIED_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function redactSecrets(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line;
      return SECRET_LINE_PATTERNS.some((pattern) => pattern.test(trimmed))
        ? "[redacted: possible credential]"
        : trimmed;
    })
    .join("\n");
}

/**
 * Returns a bounded, redacted copy of the client's editor context, or null if
 * nothing survives the filter. Never throws: bad context is dropped, not an
 * error the user has to deal with mid-conversation.
 */
export function sanitizeCodeContext(context: CodeContext | null | undefined): CodeContext | null {
  if (!context) return null;

  const activeFile =
    context.activeFile && isSafePath(context.activeFile.path)
      ? { path: context.activeFile.path, languageId: context.activeFile.languageId }
      : null;

  const selection =
    context.selection && isSafePath(context.selection.path)
      ? {
          ...context.selection,
          text: redactSecrets(context.selection.text).slice(0, MAX_SELECTION_CHARS),
        }
      : null;

  const diagnostics = context.diagnostics
    .filter((diagnostic) => isSafePath(diagnostic.path))
    .slice(0, MAX_DIAGNOSTICS)
    .map((diagnostic) => ({ ...diagnostic, message: redactSecrets(diagnostic.message).slice(0, 500) }));

  const relatedFiles = context.relatedFiles.filter(isSafePath).slice(0, MAX_RELATED_FILES);

  const sanitized: CodeContext = {
    activeFile,
    selection,
    diagnostics,
    branch: context.branch ? context.branch.slice(0, 200) : null,
    workingTree: context.workingTree ? redactSecrets(context.workingTree).slice(0, 1000) : null,
    relatedFiles,
  };

  const empty =
    !sanitized.activeFile &&
    !sanitized.selection &&
    sanitized.diagnostics.length === 0 &&
    !sanitized.branch &&
    !sanitized.workingTree &&
    sanitized.relatedFiles.length === 0;

  return empty ? null : sanitized;
}

/** Compact prompt rendering. Only what the model can act on. */
export function describeCodeContext(context: CodeContext): string {
  const lines: string[] = ["Editor context (what the user is looking at right now):"];
  if (context.activeFile) lines.push(`- Active file: ${context.activeFile.path}`);
  if (context.branch) lines.push(`- Branch: ${context.branch}`);
  if (context.workingTree) lines.push(`- Uncommitted: ${context.workingTree}`);
  if (context.selection) {
    lines.push(
      `- Selected lines ${context.selection.startLine}-${context.selection.endLine} of ${context.selection.path}:`,
      context.selection.text,
    );
  }
  for (const diagnostic of context.diagnostics) {
    lines.push(`- ${diagnostic.severity} at ${diagnostic.path}:${diagnostic.line}: ${diagnostic.message}`);
  }
  if (context.relatedFiles.length > 0) lines.push(`- Related files: ${context.relatedFiles.join(", ")}`);
  return lines.join("\n");
}
