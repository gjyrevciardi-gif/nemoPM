import * as vscode from "vscode";
import type {
  AgentApplyResponse,
  AgentResponse,
  AiStatusResponse,
  ConfirmPlanInput,
  CreateIssueInput,
  CreateSprintInput,
  Issue,
  PlanTaskResponse,
  Project,
  ProjectState,
  Sprint,
  UpdateProjectInput,
} from "@ai-pm/shared";

export class ApiClientError extends Error {}

export function baseUrl(): string {
  return vscode.workspace.getConfiguration("aiPm").get<string>("apiUrl", "http://127.0.0.1:43821");
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${baseUrl()}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch (err) {
    throw new ApiClientError(
      `Could not reach the AI PM API at ${baseUrl()}. Make sure \`pnpm dev\` is running. (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message = body?.error?.message ?? `Request to ${path} failed with status ${res.status}`;
    throw new ApiClientError(message);
  }
  return body as T;
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined });
}
function patch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
}

export const api = {
  listProjects: () => request<Project[]>("/projects"),
  getProject: (id: string) => request<Project>(`/projects/${id}`),
  updateProject: (id: string, input: UpdateProjectInput) => patch<Project>(`/projects/${id}`, input),

  listIssues: (projectId: string) => request<Issue[]>(`/projects/${projectId}/issues`),
  getIssue: (id: string) => request<Issue>(`/issues/${id}`),
  createIssue: (input: CreateIssueInput) => post<Issue>("/issues", input),
  startIssue: (id: string) => post<Issue>(`/issues/${id}/start`),
  reviewIssue: (id: string) => post<Issue>(`/issues/${id}/review`),
  completeIssue: (id: string) => post<Issue>(`/issues/${id}/complete`),

  scanGit: (projectId: string) =>
    post<{ newCommitsDetected: number; branchChanged: boolean }>(`/projects/${projectId}/git/scan`),

  getProjectState: (projectId: string) => request<ProjectState>(`/projects/${projectId}/state`),

  getAiStatus: (projectId: string, question?: string) =>
    post<AiStatusResponse>(`/projects/${projectId}/ai/status`, question ? { question } : {}),
  planTask: (projectId: string, taskRequest: string) =>
    post<PlanTaskResponse>(`/projects/${projectId}/ai/plan-task`, { request: taskRequest }),
  confirmPlan: (projectId: string, input: ConfirmPlanInput) =>
    post<Issue[]>(`/projects/${projectId}/ai/plan-task/confirm`, input),

  runAgent: (projectId: string, message: string) =>
    post<AgentResponse>(`/projects/${projectId}/agent`, { message }),
  applyAgentRun: (projectId: string, runId: string) =>
    post<AgentApplyResponse>(`/projects/${projectId}/agent/${runId}/apply`),

  listSprints: (projectId: string) => request<Sprint[]>(`/projects/${projectId}/sprints`),
  createSprint: (input: CreateSprintInput) => post<Sprint>("/sprints", input),
  startSprint: (id: string) => post<Sprint>(`/sprints/${id}/start`),
};
