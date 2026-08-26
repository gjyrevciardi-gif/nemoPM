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

/**
 * Found in use. Asked to rename three issues, the agent answered that it could
 * not find them and then claimed it had created and renamed them. It had none
 * of those tools: "rename" matched no rule at all, so routing fell back to a
 * read-only intent and handed the model getProjectState / findIssues / getIssue.
 *
 * The model was not hallucinating a rename it could have performed. It was asked
 * to do something with nothing to do it with, which is a routing defect, not a
 * model one -- the same defect as the MVP case above, one verb further on.
 */
describe("renaming an issue", () => {
  it("routes a rename to the tools that can write a title", async () => {
    const decision = await route("Rename HUB-4 to: Project detail page with screenshots and links");

    expect(decision.intent).toBe("issue.update");
    expect(decision.capabilities).toContain("issue_update");
    expect(decision.mutationIntent).not.toBe("none");
  });

  it("routes the plural form the same way", async () => {
    const decision = await route("Rename these three issues. Use exactly these titles: HUB-4 -> Detail page");

    expect(decision.intent).toBe("issue.update");
  });

  /**
   * The nastier half. One of the new titles contained the words "tech stack",
   * which is a topic rule for architecture talk sitting above the update rule --
   * so the *content of the new title* decided the route, and the request became
   * a request to discuss system design.
   */
  it("is not hijacked by a topic word inside the new title", async () => {
    const decision = await route(
      "Rename HUB-5 to: Filter the public project list by tech stack",
    );

    expect(decision.intent).toBe("issue.update");
    expect(decision.intent).not.toBe("bootstrap.architecture");
  });

  it("still lets a genuine architecture question through", async () => {
    const decision = await route("What tech stack should we use for this?");

    expect(decision.intent).toBe("bootstrap.architecture");
  });

  it("does not turn a question about a title into a write", async () => {
    const decision = await route("What is HUB-4 called?");

    expect(decision.mutationIntent).toBe("none");
  });
});
