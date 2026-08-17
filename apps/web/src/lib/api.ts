import type {
  Activity,
  AddDependencyInput,
  AiStatusResponse,
  ConfirmPlanInput,
  CreateIssueInput,
  CreateProjectInput,
  CreateSprintInput,
  GitStatus,
  Issue,
  IssueDependency,
  IssueStatus,
  PlanTaskResponse,
  Project,
  ProjectState,
  Risk,
  RiskThresholds,
  Sprint,
  SprintBurndown,
  UpdateIssueInput,
  UpdateProjectInput,
  UpdateRiskThresholdsInput,
} from "@ai-pm/shared";

export const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://127.0.0.1:43821";

export interface CodeLink {
  id: string;
  projectId: string;
  issueId: string | null;
  repositoryId: string;
  commitHash: string;
  branch: string | null;
  subject: string;
  author: string | null;
  changedFiles: string[];
  committedAt: string | null;
  createdAt: string;
}

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch (err) {
    throw new ApiRequestError(
      0,
      "NETWORK_ERROR",
      `Could not reach the AI PM API at ${API_BASE}. Is \`pnpm dev\` running?`,
    );
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const body = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message = body?.error?.message ?? `Request failed with status ${res.status}`;
    const code = body?.error?.code ?? "UNKNOWN_ERROR";
    throw new ApiRequestError(res.status, code, message);
  }

  return body as T;
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined });
}
function patch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
}
function put<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "PUT", body: JSON.stringify(body) });
}
function del<T>(path: string): Promise<T> {
  return request<T>(path, { method: "DELETE" });
}

export const api = {
  // Projects
  listProjects: () => request<Project[]>("/projects"),
  getProject: (id: string) => request<Project>(`/projects/${id}`),
  createProject: (input: CreateProjectInput) => post<Project>("/projects", input),
  updateProject: (id: string, input: UpdateProjectInput) => patch<Project>(`/projects/${id}`, input),
  deleteProject: (id: string) => del<void>(`/projects/${id}`),

  // Issues
  listIssues: (projectId: string) => request<Issue[]>(`/projects/${projectId}/issues`),
  getIssue: (id: string) => request<Issue>(`/issues/${id}`),
  createIssue: (input: CreateIssueInput) => post<Issue>("/issues", input),
  updateIssue: (id: string, input: UpdateIssueInput) => patch<Issue>(`/issues/${id}`, input),
  deleteIssue: (id: string) => del<void>(`/issues/${id}`),
  reorderIssues: (projectId: string, updates: { id: string; status: IssueStatus; position: number }[]) =>
    post<Issue[]>(`/projects/${projectId}/issues/reorder`, { updates }),
  startIssue: (id: string) => post<Issue>(`/issues/${id}/start`),
  reviewIssue: (id: string) => post<Issue>(`/issues/${id}/review`),
  completeIssue: (id: string) => post<Issue>(`/issues/${id}/complete`),

  // Dependencies
  addDependency: (issueId: string, input: AddDependencyInput) =>
    post<IssueDependency>(`/issues/${issueId}/dependencies`, input),
  listDependencies: (issueId: string) => request<IssueDependency[]>(`/issues/${issueId}/dependencies`),
  removeDependency: (issueId: string, dependencyId: string) =>
    del<void>(`/issues/${issueId}/dependencies/${dependencyId}`),
  listCodeLinks: (issueId: string) => request<CodeLink[]>(`/issues/${issueId}/code-links`),

  // Sprints
  listSprints: (projectId: string) => request<Sprint[]>(`/projects/${projectId}/sprints`),
  createSprint: (input: CreateSprintInput) => post<Sprint>("/sprints", input),
  startSprint: (id: string) => post<Sprint>(`/sprints/${id}/start`),
  completeSprint: (id: string) => post<Sprint>(`/sprints/${id}/complete`),
  getSprintBurndown: (id: string) => request<SprintBurndown>(`/sprints/${id}/burndown`),

  // Activity
  listActivity: (projectId: string, limit = 100) =>
    request<Activity[]>(`/projects/${projectId}/activity?limit=${limit}`),
  listIssueActivity: (projectId: string, issueId: string, limit = 100) =>
    request<Activity[]>(`/projects/${projectId}/activity?limit=${limit}&issueId=${issueId}`),

  // Git
  getGitStatus: (projectId: string) => request<GitStatus>(`/projects/${projectId}/git/status`),
  scanGit: (projectId: string) =>
    post<{ status: GitStatus; newCommitsDetected: number; branchChanged: boolean }>(
      `/projects/${projectId}/git/scan`,
    ),

  // State + risks
  getProjectState: (projectId: string) => request<ProjectState>(`/projects/${projectId}/state`),
  listRisks: (projectId: string) => request<Risk[]>(`/projects/${projectId}/risks`),

  // AI
  getAiStatus: (projectId: string, question?: string) =>
    post<AiStatusResponse>(`/projects/${projectId}/ai/status`, question ? { question } : {}),
  planTask: (projectId: string, taskRequest: string) =>
    post<PlanTaskResponse>(`/projects/${projectId}/ai/plan-task`, { request: taskRequest }),
  confirmPlan: (projectId: string, input: ConfirmPlanInput) =>
    post<Issue[]>(`/projects/${projectId}/ai/plan-task/confirm`, input),

  // Settings
  getRiskThresholds: () => request<RiskThresholds>("/settings/risk-thresholds"),
  updateRiskThresholds: (input: UpdateRiskThresholdsInput) =>
    put<RiskThresholds>("/settings/risk-thresholds", input),
};
