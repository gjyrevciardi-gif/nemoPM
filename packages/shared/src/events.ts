import { z } from "zod";

/**
 * Broadcast whenever a request changes project data, so every open surface --
 * browser tabs, the VS Code extension, a second editor window -- catches up
 * without the user reloading anything.
 *
 * Deliberately coarse: it says *that* something changed and which project it
 * belongs to, not what the change was. Clients refetch what they're showing,
 * which keeps this contract stable as routes come and go.
 */
export const ChangeEventSchema = z.object({
  /** Owning project, or null when the change isn't project-scoped (a new project, settings). */
  projectId: z.string().nullable(),
  /** The request that caused it -- enough to explain a surprising refresh in a log. */
  method: z.string(),
  path: z.string(),
  at: z.string(),
});
export type ChangeEvent = z.infer<typeof ChangeEventSchema>;
