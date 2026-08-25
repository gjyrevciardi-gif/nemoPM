import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommitWatcher } from "../src/commitWatcher.js";
import { createdWatchers, resetVsCodeStub } from "./vscode-stub.js";

const notifyCommits = vi.fn();

vi.mock("../src/api.js", () => ({
  api: { notifyCommits: (...args: unknown[]) => notifyCommits(...args) },
  ApiClientError: class extends Error {},
}));

const SETTLE_MS = 1500;

let logs: string[];
let proposals: number[];
let projectId: string | null;
let watcher: CommitWatcher;

const newWatcher = () =>
  new CommitWatcher(
    () => projectId,
    (count) => proposals.push(count),
    (message) => logs.push(message),
  );

beforeEach(() => {
  vi.useFakeTimers();
  resetVsCodeStub();
  notifyCommits.mockReset();
  notifyCommits.mockResolvedValue({ linked: 1, run: { id: "run-1" }, proposed: [{ issueKey: "WAL-1" }] });
  logs = [];
  proposals = [];
  projectId = "project-1";
  watcher = newWatcher();
});

afterEach(() => {
  watcher.dispose();
  vi.useRealTimers();
});

/**
 * The last untested piece of the system. It is a small amount of editor glue,
 * but what it gets wrong is silent: a watcher on the wrong path, or one that
 * fires per HEAD movement during a rebase, fails in ways nobody sees until the
 * board is quietly out of step with the repository.
 */
describe("watching a repository for commits", () => {
  it("watches the file git appends to on every HEAD movement", () => {
    watcher.start("/repo");

    expect(createdWatchers).toHaveLength(1);
    expect(createdWatchers[0]!.pattern.base).toBe("/repo");
    expect(createdWatchers[0]!.pattern.pattern.replace(/\\/g, "/")).toBe(".git/logs/HEAD");
  });

  it("does nothing without a workspace folder", () => {
    watcher.start(null);

    expect(createdWatchers).toHaveLength(0);
  });

  it("reports the commit after things settle", async () => {
    watcher.start("/repo");
    createdWatchers[0]!.emitChange();

    // Nothing yet: a rebase moves HEAD several times in a row.
    expect(notifyCommits).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(SETTLE_MS);

    expect(notifyCommits).toHaveBeenCalledTimes(1);
    expect(notifyCommits).toHaveBeenCalledWith("project-1");
  });

  it("collapses a burst of HEAD movements into one report", async () => {
    watcher.start("/repo");
    for (let i = 0; i < 5; i++) createdWatchers[0]!.emitChange();

    await vi.advanceTimersByTimeAsync(SETTLE_MS);

    expect(notifyCommits).toHaveBeenCalledTimes(1);
  });

  it("also reacts to the log file appearing for the first time", async () => {
    watcher.start("/repo");
    createdWatchers[0]!.emitCreate();

    await vi.advanceTimersByTimeAsync(SETTLE_MS);

    expect(notifyCommits).toHaveBeenCalledTimes(1);
  });

  it("says nothing when no project is connected", async () => {
    projectId = null;
    watcher.start("/repo");
    createdWatchers[0]!.emitChange();

    await vi.advanceTimersByTimeAsync(SETTLE_MS);

    expect(notifyCommits).not.toHaveBeenCalled();
  });

  it("announces proposals, and only when there are some", async () => {
    watcher.start("/repo");
    createdWatchers[0]!.emitChange();
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(proposals).toEqual([1]);

    notifyCommits.mockResolvedValue({ linked: 1, run: null, proposed: [] });
    createdWatchers[0]!.emitChange();
    await vi.advanceTimersByTimeAsync(SETTLE_MS);

    expect(proposals).toEqual([1]);
  });

  // The developer was committing, not asking NEMO for anything. A background
  // inference that fails must not interrupt them.
  it("swallows a failed report into the log rather than throwing", async () => {
    notifyCommits.mockRejectedValue(new Error("connection refused"));
    watcher.start("/repo");
    createdWatchers[0]!.emitChange();

    await expect(vi.advanceTimersByTimeAsync(SETTLE_MS)).resolves.not.toThrow();
    expect(logs.some((line) => line.includes("connection refused"))).toBe(true);
    expect(proposals).toEqual([]);
  });

  it("stops watching when disposed, and drops a pending report", async () => {
    watcher.start("/repo");
    createdWatchers[0]!.emitChange();
    watcher.dispose();

    await vi.advanceTimersByTimeAsync(SETTLE_MS);

    expect(createdWatchers[0]!.disposed).toBe(true);
    expect(notifyCommits).not.toHaveBeenCalled();
  });

  it("replaces its watcher rather than stacking them when the folder changes", () => {
    watcher.start("/repo-one");
    watcher.start("/repo-two");

    expect(createdWatchers).toHaveLength(2);
    expect(createdWatchers[0]!.disposed).toBe(true);
    expect(createdWatchers[1]!.disposed).toBe(false);
  });
});
