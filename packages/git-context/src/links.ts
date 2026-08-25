import type { CommitRecord } from "./commits.js";

/**
 * Issue keys as NEMO writes them: an uppercase project key, a hyphen, a number.
 * Anchored to word boundaries so "WAL-3" in a sentence is found but "SHA-256"
 * and "UTF-8" are not mistaken for issues -- those are exactly the shapes that
 * appear in real commit subjects.
 */
const ISSUE_KEY = /\b([A-Z][A-Z0-9]*)-(\d+)\b/g;

/** Words that look like keys but never are. */
const NOT_KEYS = new Set(["SHA", "UTF", "ISO", "RFC", "AES", "RGB", "HTTP", "IPV", "MD", "CVE", "PR", "ES"]);

export interface CommitIssueLink {
  commitHash: string;
  shortHash: string;
  subject: string;
  author: string;
  timestamp: string;
  issueKey: string;
  changedFiles: string[];
}

/**
 * Issue keys mentioned in a piece of commit text.
 *
 * Grounding is the caller's job: this reports what was written, and callers
 * filter against the keys that actually exist. A commit that references a
 * mistyped key must not silently create a link to nothing.
 */
export function extractIssueKeys(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(ISSUE_KEY)) {
    const prefix = match[1]!;
    if (NOT_KEYS.has(prefix)) continue;
    found.add(`${prefix}-${match[2]}`);
  }
  return [...found];
}

/**
 * Links commits to issues that exist.
 *
 * Only keys present in `knownKeys` produce a link, so a typo or a key belonging
 * to another project can never attach work to an issue that does not exist.
 */
export function linkCommitsToIssues(commits: CommitRecord[], knownKeys: Set<string>): CommitIssueLink[] {
  const links: CommitIssueLink[] = [];
  for (const commit of commits) {
    for (const key of extractIssueKeys(commit.subject)) {
      if (!knownKeys.has(key.toUpperCase())) continue;
      links.push({
        commitHash: commit.hash,
        shortHash: commit.shortHash,
        subject: commit.subject,
        author: commit.author,
        timestamp: commit.timestamp,
        issueKey: key.toUpperCase(),
        changedFiles: commit.changedFiles,
      });
    }
  }
  return links;
}
