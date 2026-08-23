import type Database from "better-sqlite3";
import {learningRepo,projectsRepo,repositoriesRepo} from "@ai-pm/database";
import type {ProjectMode,ProjectModeFeatures,RoutingDecision} from "@ai-pm/shared";

export interface IntentRouter{route(message:string,features:ProjectModeFeatures,options?:{hasCodeContext?:boolean}):RoutingDecision|Promise<RoutingDecision>}
export function collectModeFeatures(db:Database.Database,projectId:string):ProjectModeFeatures{const project=projectsRepo.getProjectOrThrow(db,projectId);const persisted=learningRepo.getProjectMode(db,projectId);const repo=repositoriesRepo.getRepositoryByProject(db,projectId);const issue=db.prepare("SELECT COUNT(*) total,SUM(CASE WHEN status IN ('in_progress','in_review') THEN 1 ELSE 0 END) active,SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) done FROM issues WHERE project_id=?").get(projectId) as any;const sprint=db.prepare("SELECT COUNT(*) total,SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) active FROM sprints WHERE project_id=?").get(projectId) as any;const repoRow=repo?db.prepare("SELECT last_scanned_at FROM repositories WHERE id=?").get(repo.id) as any:null;return{projectCreatedAt:project.createdAt,explicitMode:persisted?.source==="USER_OVERRIDE"?persisted.mode:null,repositoryConnected:!!repo||!!project.repositoryPath,repositoryScanned:!!repoRow?.last_scanned_at,totalIssues:issue.total??0,activeIssues:issue.active??0,totalSprints:sprint.total??0,activeSprint:(sprint.active??0)>0,completedRatio:issue.total?(issue.done??0)/issue.total:0,recentRepositoryActivity:!!repoRow?.last_scanned_at&&Date.now()-Date.parse(repoRow.last_scanned_at)<14*864e5,description:project.description};}
export function detectProjectMode(f:ProjectModeFeatures,message=""){if(f.explicitMode)return{mode:f.explicitMode,confidence:1,reason:"explicit project override"};const explicit:Record<string,ProjectMode>={"new project":"BOOTSTRAP","from zero":"BOOTSTRAP","haven't written code":"BOOTSTRAP","no code yet":"BOOTSTRAP","old repository":"IMPORTED","existing repository":"IMPORTED","project is finished":"COMPLETED","project is completed":"COMPLETED","only maintaining":"MAINTENANCE"};for(const[k,v]of Object.entries(explicit))if(message.toLowerCase().includes(k))return{mode:v,confidence:.98,reason:`explicit message signal: ${k}`};if(f.activeSprint||f.activeIssues>0||(f.repositoryScanned&&f.recentRepositoryActivity&&f.totalIssues>0))return{mode:"ACTIVE" as const,confidence:.93,reason:"active sprint, work, or repository activity"};if(f.repositoryConnected&&f.repositoryScanned&&f.totalIssues===0)return{mode:"IMPORTED" as const,confidence:.86,reason:"connected repository awaiting PM reconciliation"};if((!f.repositoryConnected||!f.repositoryScanned)&&f.totalIssues===0&&f.totalSprints===0)return{mode:"BOOTSTRAP" as const,confidence:.97,reason:"new or empty project; Git is optional during planning"};if(f.completedRatio===1&&f.totalIssues>0&&!f.activeSprint)return{mode:"COMPLETED" as const,confidence:.87,reason:"all tracked work completed"};if(f.repositoryConnected&&!f.activeSprint)return{mode:"MAINTENANCE" as const,confidence:.72,reason:"established repository without active feature sprint"};return{mode:"BOOTSTRAP" as const,confidence:.65,reason:"planning-safe fallback"};}

const intentRules:Array<[RegExp,string,string[],"none"|"ask"|"auto"|"blocked"]>=[
[/\b(smallest|min(?:imum)?|define|scope)\b.*\bmvp\b|\bmvp\b/i,"bootstrap.define_mvp",["product_planning","architecture"],"none"],
[/\b(history|historical|what happened|past milestones?)\b/i,"history.query",["memory","common_read"],"none"],
[/\b(why did we|recall|what did we decide)\b/i,"memory.query",["memory"],"none"],
[/\b(architecture|tech stack|system design)\b/i,"bootstrap.architecture",["architecture","memory"],"none"],
[/\b(create|define|draft)\b.*\bepics?\b/i,"bootstrap.create_epics",["product_planning","issue_create"],"ask"],
[/\b(create|turn|build)\b.*\bbacklog\b/i,"bootstrap.create_backlog",["backlog_read","issue_create"],"ask"],
[/\b(plan|create)\b.*\b(?:sprint\s*1|first sprint)\b/i,"bootstrap.plan_first_sprint",["backlog_read","sprint_management"],"ask"],
[/\b(new project|define (?:it|the product)|product definition|help me plan|from zero)\b/i,"bootstrap.define_product",["product_planning","memory"],"none"],
[/\b(status|progress|project state|state of (?:this|the) project|how are we|where are we)\b/i,"project.status",["project_status","common_read"],"none"],
[/\b(risk|risks|blockers?)\b/i,"project.risk",["risk_read","common_read"],"none"],
[/\b(next actions?|what next|what .* next|next steps?|do next)\b/i,"project.next_actions",["common_read"],"none"],
[/\b(create|add|open|file|log)\b.*\b(issue|bug|task|story|ticket)\b/i,"issue.create",["issue_create"],"ask"],
[/\b(update|change|move|mark|set|priority|story points?|estimate)\b.*(?:\b(issue|task|bug|story|status|priority|story points?)\b|\b[A-Z]+-\d+\b)|\b[A-Z]+-\d+\b.*\b(story points?|priority|status)\b/i,"issue.update",["issue_update"],"ask"],
[/\b(break down|subtasks?|parent)\b/i,"issue.breakdown",["issue_structure"],"ask"],
[/\b(sprint review|review sprint)\b/i,"sprint.review",["sprint_management","common_read"],"none"],
[/\b(complete|close)\b.*\bsprint\b/i,"sprint.complete",["sprint_management"],"ask"],
[/\b(plan|scope|capacity|carry)\b.*\bsprint\b/i,"sprint.plan",["backlog_read","sprint_management"],"ask"],
[/\b(record|remember|save)\b.*\b(decision|this|project note)\b/i,"memory.record",["memory"],"ask"],
[/\b(code|function|selection|diff|repository)\b.*\b(explain|work|issue|change)\b|\b(explain|link|create)\b.*\b(code|function|selection|diff|repository)\b/i,"code.explain_work",["code_context"],"none"],
[/\bportfolio\b/i,"portfolio.analyze",["portfolio_read"],"none"]];
/**
 * Picks the intent rule for a message. Rules are ordered, and first match wins --
 * which is wrong when a topic rule sits above an action rule: "create the backlog
 * issues for that MVP" mentions MVP, so it matched `bootstrap.define_mvp`, whose
 * mutation intent is "none". That leaves the agent holding read-only tools, so it
 * described a backlog it had no way to create.
 *
 * When the message plainly asks for something to be made, a rule that can write
 * outranks a rule that merely shares its topic. Questions are left alone: "what is
 * the MVP" must never reach for a write tool.
 */
function selectIntentRule(message: string) {
  const matches = intentRules.filter(([pattern]) => pattern.test(message));
  const asksForAction =
    /\b(create|add|build|turn|draft|record|open|file|log|make)\b/i.test(message) &&
    !/^\s*(what|which|why|how|when|who|is|are|does|do|can|should)\b/i.test(message);
  return (asksForAction ? matches.find(([, , , mutation]) => mutation !== "none") : undefined) ?? matches[0];
}

export class DeterministicRouter implements IntentRouter{route(message:string,f:ProjectModeFeatures,o:{hasCodeContext?:boolean}={}):RoutingDecision{const detected=detectProjectMode(f,message);const rule=selectIntentRule(message);let intent=rule?.[1]??(detected.mode==="BOOTSTRAP"?"bootstrap.define_product":"project.next_actions");let capabilities=rule?.[2]??["common_read"];if(o.hasCodeContext&&!capabilities.includes("code_context"))capabilities=[...capabilities,"code_context"];const repoIntent=/^(code\.|history\.reconstruct)/.test(intent);return{projectMode:detected.mode,intent,capabilities,needsRepositoryContext:repoIntent&&f.repositoryConnected,needsCodeContext:intent.startsWith("code."),mutationIntent:rule?.[3]??"none",confidence:Math.min(detected.confidence,rule?.[0]?0.96:0.62),reason:`${detected.reason}; ${rule?"deterministic intent match":"safe mode-specific fallback"}`};}}
export class LLMRouter implements IntentRouter{constructor(private classify:(message:string,features:ProjectModeFeatures)=>Promise<RoutingDecision>){}route(m:string,f:ProjectModeFeatures){return this.classify(m,f)}}
export class FutureFineTunedRouter extends LLMRouter{}
export function responseContract(intent:string){if(intent.startsWith("bootstrap."))return["PRODUCT","MVP","NON-GOALS","ARCHITECTURE","EPICS","MILESTONES","OPEN DECISIONS"];if(intent==="project.status")return["PROGRESS","CURRENT WORK","RISKS","RECENT CHANGES","NEXT ACTION"];if(intent==="memory.query")return["ANSWER","EVIDENCE"];return["ANSWER","NEXT ACTION"]}
export async function makeRoutingDecision(db:Database.Database,projectId:string,message:string,hasCodeContext=false,router:IntentRouter=new DeterministicRouter()){const features=collectModeFeatures(db,projectId);return{features,decision:await router.route(message,features,{hasCodeContext})};}
export function reconcileProjectMode(db:Database.Database,projectId:string){const current=learningRepo.getProjectMode(db,projectId);const features=collectModeFeatures(db,projectId);if(current?.source==="USER_OVERRIDE")return{changed:false,...current};const detected=detectProjectMode(features);const allowed=current?.mode==="BOOTSTRAP"&&detected.mode==="ACTIVE"||current?.mode==="IMPORTED"&&detected.mode==="ACTIVE"||!current?.mode;if(!allowed||current?.mode===detected.mode)return{changed:false,mode:current?.mode??detected.mode,source:current?.source??"DETECTED"};learningRepo.setProjectMode(db,projectId,detected.mode,current?.mode?"TRANSITION":"DETECTED",detected.reason,features as unknown as Record<string,unknown>);return{changed:true,mode:detected.mode,source:current?.mode?"TRANSITION":"DETECTED"};}
