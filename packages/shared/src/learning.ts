import { z } from "zod";

export const ProjectModeSchema=z.enum(["BOOTSTRAP","ACTIVE","IMPORTED","MAINTENANCE","COMPLETED"]);
export type ProjectMode=z.infer<typeof ProjectModeSchema>;
export const MutationIntentSchema=z.enum(["none","auto","ask","blocked"]);
export const TrainingReviewStatusSchema=z.enum(["UNREVIEWED","APPROVED","REJECTED"]);
export const TrainingProvenanceSchema=z.enum(["REAL_USER_CORRECTION","GROUND_TRUTH_REVIEW","REGRESSION_CASE","SYNTHETIC"]);
export const FailureCategorySchema=z.enum(["WRONG_PROJECT_MODE","WRONG_INTENT","WRONG_TOOL_GROUP","WRONG_TOOL","WRONG_ARGUMENT","UNNECESSARY_TOOL","MISSING_CONTEXT","EXCESS_CONTEXT","HALLUCINATION","AMBIGUITY_FAILURE","UNSAFE_ACTION","BAD_FINAL_RESPONSE","TIMEOUT","OTHER"]);
export const RoutingDecisionSchema=z.object({projectMode:ProjectModeSchema,intent:z.string(),capabilities:z.array(z.string()),needsRepositoryContext:z.boolean(),needsCodeContext:z.boolean(),mutationIntent:MutationIntentSchema,confidence:z.number().min(0).max(1),reason:z.string()});
export type RoutingDecision=z.infer<typeof RoutingDecisionSchema>;
export interface ProjectModeFeatures { projectCreatedAt:string; explicitMode?:ProjectMode|null; repositoryConnected:boolean; repositoryScanned:boolean; totalIssues:number; activeIssues:number; totalSprints:number; activeSprint:boolean; completedRatio:number; recentRepositoryActivity:boolean; description?:string|null }
export interface TrainingExample { id:string; projectId:string; input:{message:string;projectModeEvidence:Record<string,unknown>;projectStateSummary:Record<string,unknown>};expected:{projectMode:ProjectMode;intent:string;capabilities:string[];needsRepositoryContext:boolean;needsCodeContext:boolean;mutationIntent:string;tools?:string[]};forbidden:string[];category:string;provenance:string;reviewStatus:string;createdAt:string }
