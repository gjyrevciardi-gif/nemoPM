import { z } from "zod";

export const GitCommitSchema = z.object({
  hash: z.string(),
  shortHash: z.string(),
  subject: z.string(),
  author: z.string(),
  timestamp: z.string(),
});
export type GitCommit = z.infer<typeof GitCommitSchema>;

export const GitStatusSchema = z.object({
  connected: z.boolean(),
  repositoryPath: z.string().nullable(),
  error: z.string().nullable(),
  branch: z.string().nullable(),
  isClean: z.boolean().nullable(),
  stagedFiles: z.array(z.string()),
  unstagedFiles: z.array(z.string()),
  recentCommits: z.array(GitCommitSchema),
  latestCommitAt: z.string().nullable(),
});
export type GitStatus = z.infer<typeof GitStatusSchema>;

export const RepositorySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  path: z.string(),
  createdAt: z.string(),
});
export type Repository = z.infer<typeof RepositorySchema>;
