import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTestDb, codeLinksRepo, intelligenceRepo, issuesRepo, projectsRepo } from "@ai-pm/database";
import { buildRepositorySnapshot, decideAutonomy, getProjectIntelligence, ingestAndReconcile, DEFAULT_AUTONOMY } from "../src/lib/intelligence.js";

const dirs:string[]=[];
afterEach(()=>{for(const dir of dirs.splice(0))fs.rmSync(dir,{recursive:true,force:true});});
function repository(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),"nemo-intelligence-"));dirs.push(dir);execFileSync("git",["init","-b","main"],{cwd:dir});execFileSync("git",["config","user.email","nemo@test.local"],{cwd:dir});execFileSync("git",["config","user.name","NEMO Test"],{cwd:dir});return dir;}
function commit(dir:string,file:string,content:string,message:string){const target=path.join(dir,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content);execFileSync("git",["add","."],{cwd:dir});execFileSync("git",["commit","-m",message],{cwd:dir});}

describe("autonomous project intelligence",()=>{
  it("builds a bounded deterministic snapshot",async()=>{const dir=repository();commit(dir,"package.json",'{"scripts":{"test":"vitest"}}',"initial");commit(dir,"src/auth.test.ts","// TODO: expiry\nexport {};","add tests");const snapshot=await buildRepositorySnapshot(dir);expect(snapshot.technologies).toContain("Node.js");expect(snapshot.tests).toContain("src/auth.test.ts");expect(snapshot.todos).toHaveLength(1);expect(snapshot.currentBranch).toBe("main");expect(snapshot.files.length).toBeLessThanOrEqual(2500);});

  it("imports, explicitly links evidence, proposes inference, and stays idempotent",async()=>{const dir=repository();const db=createTestDb();const project=projectsRepo.createProject(db,{name:"Ecommerce",key:"ECOM",repositoryPath:dir});const issue=issuesRepo.createIssue(db,{projectId:project.id,type:"task",title:"Checkout",status:"in_progress",priority:"high"});commit(dir,"src/checkout.ts","export const checkout=1;","ECOM-1 implement checkout");commit(dir,"src/retry.ts","export const retry=1;\n","add retry handling");commit(dir,"test/retry.test.ts","export {};\n","test retry handling");const first=await ingestAndReconcile(db,project.id);expect(first.digest.events).toBeGreaterThan(0);expect(codeLinksRepo.listCodeLinksForIssue(db,issue.id)).toHaveLength(1);const state=getProjectIntelligence(db,project.id);expect(state.digest.untrackedWork).toBeGreaterThan(0);expect(state.actions.some(a=>a.actionType==="issue.move_to_review"&&a.status==="proposed")).toBe(true);const eventCount=intelligenceRepo.listEvents(db,project.id).length;const second=await ingestAndReconcile(db,project.id);expect(second.digest.events).toBe(0);expect(intelligenceRepo.listEvents(db,project.id)).toHaveLength(eventCount);expect(codeLinksRepo.listCodeLinksForIssue(db,issue.id)).toHaveLength(1);db.close();});

  it("never treats one commit as done and blocks high impact actions",()=>{expect(decideAutonomy("issue.mark_done",1,"MEDIUM",DEFAULT_AUTONOMY)).toBe("PROPOSE");expect(decideAutonomy("project.delete",1,"HIGH",DEFAULT_AUTONOMY)).toBe("BLOCK");});
});
