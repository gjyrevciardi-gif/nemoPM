import type Database from "better-sqlite3";
import { decisionsRepo, milestonesRepo, projectNotesRepo } from "@ai-pm/database";
import type { Decision, Milestone, ProjectNote } from "@ai-pm/shared";

export const { createDecision, listDecisionsByProject, getDecision, updateDecision, deleteDecision } =
  decisionsRepo;
export const {
  createMilestone,
  listMilestonesByProject,
  getMilestone,
  confirmMilestone,
  completeMilestone,
  updateMilestone,
  deleteMilestone,
} = milestonesRepo;
export const { createNote, listNotesByProject, deleteNote } = projectNotesRepo;

export interface ProjectMemory {
  decisions: Decision[];
  milestones: Milestone[];
  notes: ProjectNote[];
}

/**
 * Everything NEMO knows about *why* a project looks the way it does. Read as
 * a unit because that's how the agent uses it: to answer "why did we..."
 * from recorded fact, or to say plainly that nothing was recorded.
 */
export function getProjectMemory(
  db: Database.Database,
  projectId: string,
  options: { includeUnconfirmedMilestones?: boolean } = {},
): ProjectMemory {
  return {
    decisions: decisionsRepo.listDecisionsByProject(db, projectId),
    milestones: milestonesRepo.listMilestonesByProject(db, projectId, {
      includeUnconfirmed: options.includeUnconfirmedMilestones,
    }),
    notes: projectNotesRepo.listNotesByProject(db, projectId),
  };
}
