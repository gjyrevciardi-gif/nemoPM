export type EvidenceStrength="STRONG"|"MEDIUM"|"WEAK";
export interface EvidenceSignal{type:string;strength:EvidenceStrength;source:string;detail:string;reference?:string;}
export interface FileEvolution{file:string;module:string;firstSeen:string|null;lastSeen:string|null;firstCommit:string|null;lastCommit:string|null;signals:EvidenceSignal[];}
export interface ModuleEvolution{module:string;files:number;firstObservableEvidence:string|null;lastObservableEvidence:string|null;tests:string[];migrations:string[];confidence:"CONFIRMED"|"HIGH_CONFIDENCE"|"INFERRED"|"UNKNOWN";evidence:EvidenceSignal[];}
export interface BranchEvidence{name:string;defaultBranch:string;state:"MERGED"|"ACTIVE_DIVERGED"|"STALE_DIVERGED"|"NO_UNIQUE_WORK"|"UNKNOWN";ahead:number;behind:number;lastActivity:string|null;changedFiles:string[];confidence:number;}
export interface TestEvidence{adapter:string;command:string[];status:"PASS"|"FAIL"|"TIMEOUT"|"UNAVAILABLE"|"NOT_RUN";durationMs:number;summary:string;failedTests:string[];timestamp:string;}
export type ReviewVerdict="CORRECT"|"PARTIALLY_CORRECT"|"WRONG"|"MISSED";
export type ReviewCategory="PROJECT_PURPOSE"|"ARCHITECTURE"|"HISTORICAL_PHASE"|"HISTORICAL_WORK"|"CURRENT_WORK"|"RISK"|"TECHNICAL_DEBT"|"NEXT_ACTION";
