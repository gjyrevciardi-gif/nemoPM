import type { ZodType } from "zod";
import { ApiError } from "@ai-pm/shared";

export { ApiError };

export function parseOrThrow<T>(schema: ZodType<T, any, any>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const message = result.error.errors
      .map((e) => `${e.path.join(".") || "(root)"}: ${e.message}`)
      .join("; ");
    throw new ApiError(400, "VALIDATION_ERROR", message);
  }
  return result.data;
}

export function notFound(resource: string, id: string): ApiError {
  return new ApiError(404, "NOT_FOUND", `${resource} not found: ${id}`);
}
