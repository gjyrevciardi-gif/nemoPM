import type { BranchEvidence, FileEvolution, ModuleEvolution } from "./evidence.js";
export type EvidenceConfidence = "CONFIRMED" | "HIGH_CONFIDENCE" | "INFERRED" | "UNKNOWN";
export type AutonomyDecision = "AUTO" | "PROPOSE" | "OBSERVE_ONLY" | "BLOCK";

export interface RepositorySnapshot {
  version: 1;
  scannedAt: string;
  repositoryPath: string;
  currentBranch: string | null;
  headCommit: string | null;
  isClean: boolean;
  uncommittedFiles: string[];
  technologies: string[];
  modules: string[];
  files: string[];
  importantFiles: string[];
  tests: string[];
  migrations: string[];
  ci: string[];
  deployments: string[];
  tags: string[];
  branches: string[];
  issueKeys: string[];
  todos: Array<{ file: string; line: number; text: string }>;
  recentCommits: Array<{ hash: string; subject: string; author: string; timestamp: string; changedFiles: string[] }>;
  health: { trackedFiles: number; tests: number; todos: number; uncommittedChanges: number };
  evidenceIntelligence?: { files: FileEvolution[]; modules: ModuleEvolution[]; branches: BranchEvidence[]; detectedTests: { adapter:string; command:string[] } | null };
}

export interface ReconstructedHistoryItem {
  id: string;
  title: string;
  kind: "phase" | "release" | "refactor" | "bugfix_period";
  confidence: EvidenceConfidence;
  evidence: string[];
  status: "PROPOSED" | "CONFIRMED" | "REJECTED";
}

export interface IntelligenceAction {
  id: string;
  projectId: string;
  eventId: string | null;
  actionType: string;
  status: "applied" | "proposed" | "observed" | "blocked" | "rejected";
  impact: "LOW" | "MEDIUM" | "HIGH";
  confidence: number;
  evidence: string[];
  policy: unknown;
  previous: unknown;
  next: unknown;
  model: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface NemoToday {
  generatedAt: string;
  projects: Array<{ projectId: string; name: string; key: string; needsAttention: string[]; changes: number; untrackedWork: number; drift: number }>;
  automaticUpdates: number;
  needsApproval: number;
}
