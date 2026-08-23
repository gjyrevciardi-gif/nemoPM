import { z } from "zod";

/**
 * What an editor knows and NEMO doesn't: the file in front of the user, what
 * they highlighted, what the language server is complaining about, and which
 * branch the work is on.
 *
 * Deliberately small. The extension attaches this only when the request looks
 * like it refers to the editor ("create a bug for this"), never the whole
 * repository, and the agent treats it as evidence about intent -- not as
 * proof that any work is done.
 */
export const CodeSelectionSchema = z.object({
  /** Workspace-relative path, e.g. "src/auth/login.ts". */
  path: z.string(),
  languageId: z.string().nullable(),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  text: z.string().max(8000),
});
export type CodeSelection = z.infer<typeof CodeSelectionSchema>;

export const CodeDiagnosticSchema = z.object({
  path: z.string(),
  line: z.number().int().min(1),
  severity: z.enum(["error", "warning"]),
  message: z.string().max(1000),
  source: z.string().nullable().default(null),
});
export type CodeDiagnostic = z.infer<typeof CodeDiagnosticSchema>;

export const CodeContextSchema = z.object({
  activeFile: z
    .object({ path: z.string(), languageId: z.string().nullable() })
    .nullable()
    .default(null),
  selection: CodeSelectionSchema.nullable().default(null),
  diagnostics: z.array(CodeDiagnosticSchema).max(20).default([]),
  branch: z.string().nullable().default(null),
  /** Summary of uncommitted work, e.g. "4 files changed (src/a.ts, src/b.ts)". Never the diff itself. */
  workingTree: z.string().nullable().default(null),
  /** Paths the user explicitly asked to consider. Never auto-filled with the whole repo. */
  relatedFiles: z.array(z.string()).max(25).default([]),
  /** Bounded diff attached only when the request explicitly references changes/diff. */
  diff: z.object({ files:z.array(z.string()).max(20), patch:z.string().max(12000) }).nullable().optional(),
});
export type CodeContext = z.infer<typeof CodeContextSchema>;
