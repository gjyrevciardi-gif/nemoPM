import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const base=process.env.OLLAMA_BASE_URL??"http://127.0.0.1:11434";
const tags=await fetch(`${base}/api/tags`).then(r=>r.json()) as {models?:{name:string}[]};
const requested=process.env.EVAL_MODELS?.split(",").map(v=>v.trim()).filter(Boolean);
const models=requested?.length?requested:(tags.models??[]).map(m=>m.name);
if(models.length===0) throw new Error("No installed Ollama models found. Nothing was downloaded.");
const summaries:any[]=[];
for(const model of models){
  const safe=model.replace(/[^a-z0-9.-]+/gi,"_"); const report=`eval-report-${safe}.md`;
  await new Promise<void>((resolve)=>{const child=spawn(process.execPath,["--import","tsx","scripts/eval-real-model.ts"],{cwd:process.cwd(),stdio:"inherit",env:{...process.env,OLLAMA_MODEL:model,EVAL_REPORT_PATH:report}});child.on("exit",()=>resolve());});
  const jsonPath=path.resolve(process.cwd(),report.replace(/\.md$/,".json")); if(fs.existsSync(jsonPath))summaries.push(JSON.parse(fs.readFileSync(jsonPath,"utf8")));
}
summaries.sort((a,b)=>b.score-a.score||a.medianMs-b.medianMs);
const suitable=summaries.filter(s=>s.score>=70);
const fastest=[...suitable].sort((a,b)=>a.medianMs-b.medianMs)[0];
console.log("\nMODEL BENCHMARK RECOMMENDATION");
console.log(`BEST DEFAULT MODEL: ${summaries[0]?.model??"none"} (${summaries[0]?.score??0}%)`);
console.log(`BEST LOW-LATENCY MODEL: ${fastest?.model??"none meeting 70% correctness"}${fastest?` (${fastest.medianMs}ms median)`:""}`);
console.log(`UNSUITABLE MODELS: ${summaries.filter(s=>s.score<70).map(s=>`${s.model} (${s.score}%)`).join(", ")||"none measured"}`);
