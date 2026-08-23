import fs from "node:fs";
import type Database from "better-sqlite3";
import { projectsRepo, repositoriesRepo } from "@ai-pm/database";
import { ingestAndReconcile } from "./intelligence.js";

const watchers = new Map<string, fs.FSWatcher>();
const timers = new Map<string, NodeJS.Timeout>();
const running = new Set<string>();
let discovery: NodeJS.Timeout | null = null;

function schedule(db:Database.Database,projectId:string,delay=1_500){ const old=timers.get(projectId);if(old)clearTimeout(old);const timer=setTimeout(async()=>{timers.delete(projectId);if(running.has(projectId))return schedule(db,projectId,2_000);running.add(projectId);try{await ingestAndReconcile(db,projectId);}catch{/* Repository may be temporarily unavailable during a checkout. */}finally{running.delete(projectId);}},delay);timer.unref();timers.set(projectId,timer); }

function discover(db:Database.Database){ for(const project of projectsRepo.listProjects(db)){ const repo=repositoriesRepo.getRepositoryByProject(db,project.id);const repoPath=repo?.path??project.repositoryPath;if(!repoPath||watchers.has(project.id)||!fs.existsSync(repoPath))continue;try{const watcher=fs.watch(repoPath,{recursive:true},(_event,file)=>{const name=String(file??"").replaceAll("\\","/");if(name.startsWith(".git/")||name.includes("/node_modules/")||name.includes("/dist/"))return;schedule(db,project.id);});watchers.set(project.id,watcher);schedule(db,project.id,100);}catch{/* Unsupported/network filesystem: manual and API reconciliation still work. */}} }

export function startIntelligenceWatchers(db:Database.Database){if(process.env.NODE_ENV==="test"||process.env.VITEST==="true")return;discover(db);discovery=setInterval(()=>discover(db),30_000);discovery.unref();}
export function stopIntelligenceWatchers(){if(discovery)clearInterval(discovery);discovery=null;for(const timer of timers.values())clearTimeout(timer);timers.clear();for(const watcher of watchers.values())watcher.close();watchers.clear();running.clear();}
