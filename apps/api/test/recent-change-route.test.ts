import { describe, expect, it } from "vitest";
import { isRecentChangeQuestion } from "../src/lib/agent.js";

/**
 * "What changed recently?" is a lookup. Routing it through a local model cost
 * ~135s on this hardware and returned the one-line answer buried under a status
 * template. These cases pin which questions get answered from the record.
 */
describe("recognising a question about recent change", () => {
  it("matches the ways people ask it in English", () => {
    for (const message of [
      "What changed recently?",
      "what's new",
      "What has happened lately?",
      "Show me the last commit",
      "what are the latest changes",
      "Which commits landed most recently?",
      "any recent activity?",
    ]) {
      expect(isRecentChangeQuestion(message), message).toBe(true);
    }
  });

  it("matches the Albanian phrasing this project's users type", () => {
    for (const message of ["cili eshte ndryshimi i fundit", "qka ka ndryshuar", "aktiviteti i fundit"]) {
      expect(isRecentChangeQuestion(message), message).toBe(true);
    }
  });

  it("never hijacks a request to change something", () => {
    for (const message of [
      "Create a task for recent change tracking",
      "Update the latest issue",
      "Move the most recent commit's work to done",
      "Record a decision about our recent architecture change",
      "delete the last activity",
    ]) {
      expect(isRecentChangeQuestion(message), message).toBe(false);
    }
  });

  it("leaves unrelated questions to the normal path", () => {
    for (const message of [
      "Why did we choose SQLite?",
      "What is blocking ECOM-4?",
      "Plan the next sprint",
      "How many issues are unfinished?",
      "What should I work on?",
    ]) {
      expect(isRecentChangeQuestion(message), message).toBe(false);
    }
  });
});
