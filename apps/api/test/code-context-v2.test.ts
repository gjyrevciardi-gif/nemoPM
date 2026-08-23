import { describe,expect,it } from "vitest";
import { describeCodeContext, sanitizeCodeContext } from "../src/lib/code-context.js";

describe("CodeContext v2 diff sanitization",()=>{
  it("keeps a bounded safe diff and redacts credentials",()=>{
    const context=sanitizeCodeContext({activeFile:null,selection:null,diagnostics:[],branch:"feature/x",workingTree:"1 file",relatedFiles:[],diff:{files:["src/auth.ts",".env"],patch:'diff --git a/src/auth.ts\n+const API_KEY = "super-secret-value"'}});
    expect(context?.diff?.files).toEqual(["src/auth.ts"]);
    expect(context?.diff?.patch).toContain("[redacted: possible credential]");
    expect(describeCodeContext(context!)).not.toContain("super-secret-value");
  });

  it("drops diffs containing only denied paths",()=>{
    const context=sanitizeCodeContext({activeFile:null,selection:null,diagnostics:[],branch:null,workingTree:null,relatedFiles:[],diff:{files:[".env","dist/app.js"],patch:"secret"}});
    expect(context).toBeNull();
  });
});
