import { z } from "zod";

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  key: z.string(),
  description: z.string().nullable(),
  repositoryPath: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const CreateProjectInputSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  key: z
    .string()
    .min(2, "Key must be at least 2 characters")
    .max(10, "Key must be 10 characters or fewer")
    .regex(/^[A-Z][A-Z0-9]*$/, "Key must be uppercase letters/numbers, starting with a letter")
    .optional(),
  description: z.string().max(2000).optional(),
  repositoryPath: z.string().max(1000).optional(),
});
export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;

export const UpdateProjectInputSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  repositoryPath: z.string().max(1000).nullable().optional(),
});
export type UpdateProjectInput = z.infer<typeof UpdateProjectInputSchema>;
