import { z } from "zod";
import { IssueTypeSchema, IssueStatusSchema, PrioritySchema } from "./enums.js";

export const IssueSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  parentId: z.string().nullable(),
  key: z.string(),
  type: IssueTypeSchema,
  title: z.string(),
  description: z.string().nullable(),
  status: IssueStatusSchema,
  priority: PrioritySchema,
  storyPoints: z.number().nullable(),
  sprintId: z.string().nullable(),
  position: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});
export type Issue = z.infer<typeof IssueSchema>;

export const CreateIssueInputSchema = z.object({
  projectId: z.string(),
  parentId: z.string().nullable().optional(),
  type: IssueTypeSchema.default("task"),
  title: z.string().min(1, "Title is required").max(300),
  description: z.string().max(10000).optional(),
  status: IssueStatusSchema.default("backlog"),
  priority: PrioritySchema.default("medium"),
  storyPoints: z.number().min(0).max(100).nullable().optional(),
  sprintId: z.string().nullable().optional(),
});
export type CreateIssueInput = z.infer<typeof CreateIssueInputSchema>;

export const UpdateIssueInputSchema = z.object({
  parentId: z.string().nullable().optional(),
  type: IssueTypeSchema.optional(),
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(10000).nullable().optional(),
  status: IssueStatusSchema.optional(),
  priority: PrioritySchema.optional(),
  storyPoints: z.number().min(0).max(100).nullable().optional(),
  sprintId: z.string().nullable().optional(),
  position: z.number().optional(),
});
export type UpdateIssueInput = z.infer<typeof UpdateIssueInputSchema>;

export const ReorderIssuesInputSchema = z.object({
  updates: z
    .array(
      z.object({
        id: z.string(),
        status: IssueStatusSchema,
        position: z.number(),
      }),
    )
    .min(1),
});
export type ReorderIssuesInput = z.infer<typeof ReorderIssuesInputSchema>;

export const AddDependencyInputSchema = z.object({
  dependsOnIssueId: z.string(),
});
export type AddDependencyInput = z.infer<typeof AddDependencyInputSchema>;

export const IssueDependencySchema = z.object({
  id: z.string(),
  issueId: z.string(),
  dependsOnIssueId: z.string(),
  createdAt: z.string(),
});
export type IssueDependency = z.infer<typeof IssueDependencySchema>;
