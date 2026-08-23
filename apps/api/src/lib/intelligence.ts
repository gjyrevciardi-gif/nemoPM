import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type Database from "better-sqlite3";
import type { AutonomyDecision, ReconstructedHistoryItem, RepositorySnapshot } from "@ai-pm/shared";
import { activitiesRepo, codeLinksRepo, intelligenceRepo, issuesRepo, projectsRepo, repositoriesRepo } from "@ai-pm/database";
import { ApiError } from "./errors.js";
import { getCurrentBranch, getStatusFiles, listCommitsSince } from "./git.js";
import { buildProjectState } from "./state.js";
import { buildUnderstandingReport } from "./project-understanding.js";
import { analyzeBranches, analyzeFileEvolution, detectTestCommand } from "./evidence-intelligence.js";

const execFileAsync = promisify(execFile);
const MAX_FILES = 2_500;
const MAX_TEXT_FILES = 300;
const MAX_FILE_BYTES = 128_000;
const SKIP = new Set([".git", "node_modules", "dist", "build", "coverage", ".next", ".cache", "vendor"]);
const TEXT_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".kt", ".rb", ".php", ".md", ".sql", ".yml", ".yaml", ".json", ".toml"]);
const ISSUE_KEY = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/g;

export interface ProjectSourceAdapter<TSnapshot> { readonly source:string; snapshot():Promise<TSnapshot>; }
export class LocalGitSource implements ProjectSourceAdapter<RepositorySnapshot>{readonly source="LocalGitSource";constructor(readonly repositoryPath:string){}snapshot(){return buildRepositorySnapshot(this.repositoryPath);}}

async function git(repoPath: string, args: string[]): Promise<string> {
  try { return (await execFileAsync("git", args, { cwd: repoPath, timeout: 10_000, maxBuffer: 5_000_000 })).stdout.trim(); }
  catch { return ""; }
}

function walk(root: string): string[] {
  const found: string[] = [];
  const visit = (dir: string) => {
    if (found.length >= MAX_FILES) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (found.length >= MAX_FILES || SKIP.has(entry.name)) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) found.push(path.relative(root, absolute).replaceAll("\\", "/"));
    }
  };
  visit(root);
  return found.sort();
}

function technologies(files: string[]): string[] {
  const rules: Array<[RegExp, string]> = [[/package\.json$/, "Node.js"], [/tsconfig.*\.json$/, "TypeScript"], [/requirements.*\.txt$|pyproject\.toml$/, "Python"], [/Cargo\.toml$/, "Rust"], [/go\.mod$/, "Go"], [/pom\.xml$|build\.gradle/, "JVM"], [/Dockerfile|compose.*\.ya?ml$/, "Docker"]];
  return [...new Set(rules.filter(([rule]) => files.some((file) => rule.test(file))).map(([, name]) => name))];
}

function fingerprint(snapshot: RepositorySnapshot): string {
  const stable = { headCommit: snapshot.headCommit, branch: snapshot.currentBranch, tags: snapshot.tags, branches: snapshot.branches, files: snapshot.files, tests: snapshot.tests, migrations: snapshot.migrations, issueKeys: snapshot.issueKeys, todos: snapshot.todos };
  return crypto.createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

export async function buildRepositorySnapshot(repoPath: string): Promise<RepositorySnapshot> {
  const files = walk(repoPath);
  const [branch, status, tagsRaw, branchesRaw, head, commits] = await Promise.all([
    getCurrentBranch(repoPath), getStatusFiles(repoPath), git(repoPath, ["tag", "--sort=-creatordate"]),
    git(repoPath, ["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes"]), git(repoPath, ["rev-parse", "HEAD"]), listCommitsSince(repoPath, null, 200),
  ]);
  const tests = files.filter((f) => /(^|\/)(__tests__|test|tests|spec)(\/|\.)|\.(test|spec)\.[^.]+$/.test(f));
  const migrations = files.filter((f) => /(^|\/)migrations?\//i.test(f));
  const importantFiles = files.filter((f) => /(^|\/)(readme|changelog|package|pyproject|cargo|go\.mod|dockerfile|compose|.*config|.*\.env\.example)/i.test(f)).slice(0, 100);
  const ci = files.filter((f) => /^\.github\/workflows\/|^\.gitlab-ci|^Jenkinsfile$/.test(f));
  const deployments = files.filter((f) => /(^|\/)(Dockerfile|docker-compose|vercel|netlify|k8s|helm|terraform)/i.test(f));
  const modules = [...new Set(files.map((f) => f.split("/")[0] ?? "").filter((d) => d.length > 0 && !d.includes(".")))].slice(0, 100);
  const todos: RepositorySnapshot["todos"] = [];
  const keys = new Set<string>();
  let inspected = 0;
  for (const file of files) {
    if (inspected >= MAX_TEXT_FILES || !TEXT_EXT.has(path.extname(file).toLowerCase())) continue;
    const absolute = path.join(repoPath, file);
    const stat = fs.statSync(absolute); if (stat.size > MAX_FILE_BYTES) continue;
    inspected++;
    const content = fs.readFileSync(absolute, "utf8");
    for (const key of content.match(ISSUE_KEY) ?? []) keys.add(key);
    content.split(/\r?\n/).forEach((line, index) => { if (todos.length < 200 && /\b(TODO|FIXME)\b/i.test(line)) todos.push({ file, line: index + 1, text: line.trim().slice(0, 240) }); });
  }
  for (const commit of commits) for (const key of commit.subject.match(ISSUE_KEY) ?? []) keys.add(key);
  return { version: 1, scannedAt: new Date().toISOString(), repositoryPath: repoPath, currentBranch: branch, headCommit: head || null, isClean: status.isClean, uncommittedFiles:[...new Set([...status.stagedFiles,...status.unstagedFiles])].slice(0,100),
    technologies: technologies(files), modules, files, importantFiles, tests, migrations, ci, deployments,
    tags: tagsRaw.split(/\r?\n/).filter(Boolean).slice(0, 100), branches: branchesRaw.split(/\r?\n/).filter(Boolean).slice(0, 100), issueKeys: [...keys].sort(), todos,
    recentCommits: commits.map(c => ({ hash:c.hash, subject:c.subject, author:c.author, timestamp:c.timestamp, changedFiles:c.changedFiles.slice(0,100) })),
    health: { trackedFiles: files.length, tests: tests.length, todos: todos.length, uncommittedChanges: status.stagedFiles.length + status.unstagedFiles.length } };
}

export function reconstructHistory(snapshot: RepositorySnapshot): ReconstructedHistoryItem[] {
  const result: ReconstructedHistoryItem[] = snapshot.tags.slice(0, 20).map((tag) => ({ id:`release:${tag}`, title:`Release ${tag}`, kind:"release", confidence:"CONFIRMED", evidence:[`Git tag ${tag}`], status:"PROPOSED" }));
  const groups = new Map<string, string[]>();
  for (const commit of snapshot.recentCommits) {
    const label = /refactor/i.test(commit.subject) ? "Refactoring" : commit.changedFiles[0]?.split("/")[0];
    if (label) groups.set(label, [...(groups.get(label) ?? []), commit.hash.slice(0, 8)]);
  }
  for (const [name, commits] of groups) if (commits.length >= 2) result.push({ id:`phase:${name}`, title:`Development phase: ${name}`, kind:name === "Refactoring" ? "refactor" : "phase", confidence:"HIGH_CONFIDENCE", evidence:commits.slice(0,10).map(c=>`commit ${c}`), status:"PROPOSED" });
  return result.slice(0, 40);
}

export interface AutonomySettings { explicitIssueLinking:"AUTO"|"PROPOSE"; riskReconciliation:"AUTO"|"PROPOSE"; moveToReview:{autoAt:number;proposeAt:number}; markDone:"AUTO"|"PROPOSE"|"BLOCK"; inferredTasks:"PROPOSE"|"BLOCK"; testExecution?:boolean; }
export const DEFAULT_AUTONOMY: AutonomySettings = { explicitIssueLinking:"AUTO", riskReconciliation:"AUTO", moveToReview:{autoAt:.95,proposeAt:.7}, markDone:"PROPOSE", inferredTasks:"PROPOSE", testExecution:false };

function ensureConnected(db:Database.Database,projectId:string){ const existing=repositoriesRepo.getRepositoryByProject(db,projectId); if(existing)return existing; const project=projectsRepo.getProject(db,projectId); if(!project)throw new ApiError(404,"NOT_FOUND",`Project not found: ${projectId}`); if(!project.repositoryPath)throw new ApiError(400,"NO_REPOSITORY","No repository connected to this project."); return repositoriesRepo.connectRepository(db,projectId,project.repositoryPath); }
export function decideAutonomy(action:string, confidence:number, impact:"LOW"|"MEDIUM"|"HIGH", settings:AutonomySettings):AutonomyDecision {
  if (impact === "HIGH" || action === "project.delete") return "BLOCK";
  if (action === "git.link_explicit") return settings.explicitIssueLinking;
  if (action === "issue.mark_done") return settings.markDone === "AUTO" && confidence >= .98 ? "AUTO" : settings.markDone === "BLOCK" ? "BLOCK" : "PROPOSE";
  if (action === "issue.move_to_review") return confidence >= settings.moveToReview.autoAt ? "AUTO" : confidence >= settings.moveToReview.proposeAt ? "PROPOSE" : "OBSERVE_ONLY";
  if (action === "issue.create_inferred") return settings.inferredTasks;
  return "OBSERVE_ONLY";
}

function diffEvents(projectId:string, repositoryId:string, before:RepositorySnapshot|null, after:RepositorySnapshot) {
  const events:Array<{type:string;dedupeKey:string;evidence:Record<string,unknown>}> = [];
  const add=(type:string,key:string,evidence:Record<string,unknown>)=>events.push({type,dedupeKey:`${repositoryId}:${type}:${key}`,evidence});
  const oldCommits=new Set(before?.recentCommits.map(c=>c.hash)??[]); for(const c of after.recentCommits) if(!oldCommits.has(c.hash)) add("repository.commit.created",c.hash,{...c,issueKeys:c.subject.match(ISSUE_KEY)??[]});
  for(const branch of after.branches) if(!before?.branches.includes(branch)) add("repository.branch.created",branch,{branch});
  for(const branch of before?.branches??[]) if(!after.branches.includes(branch)) add("repository.branch.deleted",branch,{branch});
  for(const tag of after.tags) if(!before?.tags.includes(tag)) add("repository.tag.created",tag,{tag});
  for(const migration of after.migrations) if(!before?.migrations.includes(migration)) add("repository.migration.added",migration,{file:migration});
  const oldTodos=new Set((before?.todos??[]).map(t=>`${t.file}:${t.line}:${t.text}`)); for(const todo of after.todos) { const k=`${todo.file}:${todo.line}:${todo.text}`; if(!oldTodos.has(k)) add("repository.todo.added",crypto.createHash("sha1").update(k).digest("hex"),todo); }
  if(before && before.headCommit===after.headCommit && fingerprint(before)!==fingerprint(after)) add("repository.files.changed",fingerprint(after),{uncommittedChanges:after.health.uncommittedChanges});
  return events;
}

export async function ingestAndReconcile(db:Database.Database, projectId:string) {
  const repo=ensureConnected(db,projectId); const beforeRow=intelligenceRepo.getBaseline(db,repo.id); const before=beforeRow?.snapshot as RepositorySnapshot|null;
  const source=new LocalGitSource(repo.path); const snapshot=await source.snapshot(); if(!before){const[evolution,branches]=await Promise.all([analyzeFileEvolution(snapshot),analyzeBranches(repo.path)]);const detected=detectTestCommand(repo.path);snapshot.evidenceIntelligence={...evolution,branches,detectedTests:detected?{adapter:detected.adapter,command:detected.command}:null};}else if(before.evidenceIntelligence)snapshot.evidenceIntelligence=before.evidenceIntelligence; const events=diffEvents(projectId,repo.id,before,snapshot); const settings={...DEFAULT_AUTONOMY,...(intelligenceRepo.getAutonomySettings(db,projectId)??{})} as AutonomySettings;
  let inserted=0, linked=0, proposed=0, observed=0;
  if(!before){ for(const item of reconstructHistory(snapshot)){ intelligenceRepo.recordAction(db,{projectId,actionType:"history.reconstruct",status:"proposed",impact:"MEDIUM",confidence:item.confidence==="CONFIRMED"?1:item.confidence==="HIGH_CONFIDENCE"?.85:.55,evidence:item.evidence,policy:{decision:"PROPOSE",reason:"Reconstructed history is never silently official"},next:item}); proposed++; } }
  for(const raw of events){ const saved=intelligenceRepo.recordEvent(db,{projectId,repositoryId:repo.id,source:source.source,...raw}); if(!saved.inserted) continue; inserted++;
    if(raw.type==="repository.commit.created") { const evidence=raw.evidence as {hash:string;subject:string;author:string;timestamp:string;changedFiles:string[];issueKeys:string[]};
      for(const key of evidence.issueKeys){ const issue=issuesRepo.getIssueByKey(db,projectId,key); if(!issue) continue; const confidence=1; const decision=decideAutonomy("git.link_explicit",confidence,"LOW",settings);
        if(decision==="AUTO"){ codeLinksRepo.createCodeLink(db,{projectId,issueId:issue.id,repositoryId:repo.id,commitHash:evidence.hash,branch:snapshot.currentBranch,subject:evidence.subject,author:evidence.author,changedFiles:evidence.changedFiles,committedAt:evidence.timestamp}); activitiesRepo.recordActivity(db,{projectId,issueId:issue.id,type:"intelligence.explicit_commit_linked",payload:{key,hash:evidence.hash.slice(0,8)}}); linked++; }
        intelligenceRepo.recordAction(db,{projectId,eventId:saved.event.id,actionType:"git.link_explicit",status:decision==="AUTO"?"applied":"proposed",impact:"LOW",confidence,evidence:[`Explicit issue key ${key}`,`Commit ${evidence.hash.slice(0,8)}`],policy:{decision,settings:settings.explicitIssueLinking},next:{issueKey:key,commit:evidence.hash}});
        const testFiles=evidence.changedFiles.filter(f=>/(test|spec)/i.test(f)); const completionConfidence=Math.min(.94,.55+.2+(testFiles.length? .15:0)); const statusDecision=decideAutonomy("issue.move_to_review",completionConfidence,"MEDIUM",settings); if(statusDecision==="AUTO"&&issue.status==="in_progress")issuesRepo.reviewIssue(db,issue.id); intelligenceRepo.recordAction(db,{projectId,eventId:saved.event.id,actionType:"issue.move_to_review",status:statusDecision==="AUTO"?"applied":statusDecision==="PROPOSE"?"proposed":"observed",impact:"MEDIUM",confidence:completionConfidence,evidence:[`Explicit commit for ${key}`,...(testFiles.length?[`${testFiles.length} test file(s) changed`]:[])],policy:{decision:statusDecision,thresholds:settings.moveToReview},previous:{status:issue.status},next:{issueId:issue.id,issueKey:key,status:"in_review"}}); if(statusDecision==="PROPOSE") proposed++; else observed++;
        if(issue.status==="done"&&/\b(revert|rollback|remove)\b/i.test(evidence.subject)){intelligenceRepo.recordAction(db,{projectId,eventId:saved.event.id,actionType:"drift.done_work_reverted",status:"proposed",impact:"HIGH",confidence:.9,evidence:[`Done issue ${key}`,`Commit indicates reversal: ${evidence.subject}`],policy:{decision:"PROPOSE"},previous:{status:"done"},next:{reviewRequired:true}});proposed++;}
      }
      if(evidence.issueKeys.length===0 && evidence.changedFiles.length>=1){ const confidence=evidence.changedFiles.length>=2?.72:.65; const decision=decideAutonomy("issue.create_inferred",confidence,"MEDIUM",settings); intelligenceRepo.recordAction(db,{projectId,eventId:saved.event.id,actionType:"issue.create_inferred",status:decision==="PROPOSE"?"proposed":"blocked",impact:"MEDIUM",confidence,evidence:[`Untracked commit ${evidence.hash.slice(0,8)}`,`${evidence.changedFiles.length} files changed`],policy:{decision},next:{title:evidence.subject}}); if(decision==="PROPOSE") proposed++; }
    }
    intelligenceRepo.markEventProcessed(db,saved.event.id);
  }
  if(inserted>0&&settings.riskReconciliation==="AUTO"){await buildProjectState(db,projectId);intelligenceRepo.recordAction(db,{projectId,actionType:"risk.reconcile",status:"applied",impact:"LOW",confidence:1,evidence:[`${inserted} normalized repository event(s)`],policy:{decision:"AUTO",setting:"riskReconciliation"},next:{recalculated:true}});}
  const pmVersion=crypto.createHash("sha1").update(JSON.stringify(issuesRepo.listIssuesByProject(db,projectId).map(i=>[i.id,i.status,i.updatedAt]))).digest("hex"); intelligenceRepo.upsertBaseline(db,{repositoryId:repo.id,projectId,snapshot,fingerprint:fingerprint(snapshot),headCommit:snapshot.headCommit,branch:snapshot.currentBranch,pmStateVersion:pmVersion}); repositoriesRepo.updateRepositoryScanState(db,repo.id,{commitHash:snapshot.headCommit,branch:snapshot.currentBranch});
  activitiesRepo.recordActivity(db,{projectId,type:"intelligence.scan.completed",payload:{events:inserted,linked,proposed,fingerprint:fingerprint(snapshot).slice(0,12)}});
  return {snapshot,understanding:buildUnderstandingReport(snapshot),baseline:{fingerprint:fingerprint(snapshot),previousFingerprint:beforeRow?.fingerprint??null},history:before?[]:reconstructHistory(snapshot),digest:{events:inserted,linked,proposed,observed}};
}

export function getProjectIntelligence(db:Database.Database,projectId:string){ const repo=repositoriesRepo.getRepositoryByProject(db,projectId); const baseline=repo?intelligenceRepo.getBaseline(db,repo.id):null; const understanding=baseline?buildUnderstandingReport(baseline.snapshot as RepositorySnapshot):null; const events=intelligenceRepo.listEvents(db,projectId,100); const actions=intelligenceRepo.listActions(db,projectId,100); return {baseline,understanding,events,actions,settings:intelligenceRepo.getAutonomySettings(db,projectId)??DEFAULT_AUTONOMY,digest:{changes:events.length,automatic:actions.filter(a=>a.status==="applied").length,needsApproval:actions.filter(a=>a.status==="proposed").length,untrackedWork:actions.filter(a=>a.actionType==="issue.create_inferred"&&a.status==="proposed").length,drift:actions.filter(a=>String(a.actionType).startsWith("drift.")).length},nextActions:actions.filter(a=>a.status==="proposed").slice(0,10)}; }

export function getNemoToday(db:Database.Database){ const projects=projectsRepo.listProjects(db); let automaticUpdates=0,needsApproval=0; const summaries=projects.map(project=>{const intelligence=getProjectIntelligence(db,project.id); automaticUpdates+=intelligence.digest.automatic; needsApproval+=intelligence.digest.needsApproval; const needsAttention:string[]=[]; if(intelligence.digest.untrackedWork)needsAttention.push(`${intelligence.digest.untrackedWork} untracked work proposal(s)`); if(intelligence.digest.drift)needsAttention.push(`${intelligence.digest.drift} project drift signal(s)`); if(intelligence.digest.needsApproval)needsAttention.push(`${intelligence.digest.needsApproval} approval(s) needed`); return {projectId:project.id,name:project.name,key:project.key,needsAttention,changes:intelligence.digest.changes,untrackedWork:intelligence.digest.untrackedWork,drift:intelligence.digest.drift};}); return {generatedAt:new Date().toISOString(),projects:summaries,automaticUpdates,needsApproval};}
