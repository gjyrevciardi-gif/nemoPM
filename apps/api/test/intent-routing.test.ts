import { describe, expect, it } from "vitest";
import { DeterministicRouter } from "../src/lib/project-mode.js";
import type { ProjectModeFeatures } from "@ai-pm/shared";

const BOOTSTRAP: ProjectModeFeatures = {
  projectCreatedAt: new Date().toISOString(),
  repositoryConnected: false,
  repositoryScanned: false,
  totalIssues: 0,
  activeIssues: 0,
  totalSprints: 0,
  activeSprint: false,
  completedRatio: 0,
  recentRepositoryActivity: false,
};

const route = (message: string) => new DeterministicRouter().route(message, BOOTSTRAP, {});

/**
 * The rule table is ordered and first match wins. A topic rule sitting above an
 * action rule used to swallow explicit requests: "create the backlog for that
 * MVP" matched the bare `mvp` rule, whose mutation intent is "none", so the
 * agent was handed read-only tools and could only describe what it was asked to
 * build.
 */
describe("choosing an intent when topic and action rules both match", () => {
  it("treats a request to build the backlog as a write, not as MVP talk", async () => {
    const decision = await route("Create the backlog issues for that MVP: authentication and dashboard layout.");

    expect(decision.intent).toBe("bootstrap.create_backlog");
    expect(decision.mutationIntent).not.toBe("none");
  });

  it("still reads a genuine MVP question as planning", async () => {
    for (const message of ["Define the MVP scope.", "What is the MVP?", "What should the MVP include?"]) {
      const decision = await route(message);
      expect(decision.intent, message).toBe("bootstrap.define_mvp");
      expect(decision.mutationIntent, message).toBe("none");
    }
  });

  it("never lets a question reach for a write tool", async () => {
    for (const message of [
      "What is the status of this project?",
      "Why did we choose SQLite?",
      "Which risks are open?",
      "Can you create issues later?",
    ]) {
      expect((await route(message)).mutationIntent, message).toBe("none");
    }
  });

  it("leaves the ordinary action intents where they were", async () => {
    expect((await route("Create a high priority bug for expired login tokens.")).intent).toBe("issue.create");
    expect((await route("Record the decision that we chose SQLite.")).intent).toBe("memory.record");
    expect((await route("Create the epics for this product.")).intent).toBe("bootstrap.create_epics");
  });
});
