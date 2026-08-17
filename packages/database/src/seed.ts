import { getDb } from "./db.js";
import * as projectsRepo from "./repositories/projects.js";
import * as issuesRepo from "./repositories/issues.js";
import * as sprintsRepo from "./repositories/sprints.js";
import * as dependenciesRepo from "./repositories/dependencies.js";

function main() {
  const db = getDb();

  const existing = projectsRepo
    .listProjects(db)
    .find((p) => p.key === "ACME");
  if (existing) {
    console.log(`Seed project "Acme SaaS" (${existing.key}) already exists (id=${existing.id}). Skipping.`);
    console.log("Delete data/ai-pm.db and re-run `pnpm seed` for a fresh database.");
    return;
  }

  console.log("Seeding Acme SaaS project...");

  const project = projectsRepo.createProject(db, {
    name: "Acme SaaS",
    key: "ACME",
    description: "Demo project for the AI PM MVP: a B2B SaaS auth + billing platform.",
  });

  const sprint = sprintsRepo.createSprint(db, {
    projectId: project.id,
    name: "Sprint 1",
    goal: "Ship login, dashboard v1, and password recovery.",
  });
  sprintsRepo.startSprint(db, sprint.id);

  const epic = issuesRepo.createIssue(db, {
    projectId: project.id,
    type: "epic",
    title: "Authentication Epic",
    description: "All work related to authentication, sessions, and account recovery.",
    status: "backlog",
    priority: "high",
  });

  const login = issuesRepo.createIssue(db, {
    projectId: project.id,
    parentId: epic.id,
    type: "story",
    title: "Login API",
    description: "Email/password login endpoint with session issuance.",
    status: "todo",
    priority: "high",
    storyPoints: 5,
    sprintId: sprint.id,
  });
  issuesRepo.startIssue(db, login.id);

  const dashboard = issuesRepo.createIssue(db, {
    projectId: project.id,
    type: "story",
    title: "Dashboard",
    description: "Post-login dashboard shell with account summary widgets.",
    status: "todo",
    priority: "medium",
    storyPoints: 5,
    sprintId: sprint.id,
  });

  const passwordRecovery = issuesRepo.createIssue(db, {
    projectId: project.id,
    parentId: epic.id,
    type: "story",
    title: "Password Recovery",
    description: "Forgot-password email flow with expiring reset tokens.",
    status: "todo",
    priority: "medium",
    storyPoints: 3,
    sprintId: sprint.id,
  });

  const billing = issuesRepo.createIssue(db, {
    projectId: project.id,
    type: "story",
    title: "Billing Integration",
    description: "Stripe subscription billing for paid plans.",
    status: "backlog",
    priority: "medium",
    storyPoints: 8,
  });

  const tokenBug = issuesRepo.createIssue(db, {
    projectId: project.id,
    parentId: epic.id,
    type: "bug",
    title: "Fix Token Refresh Bug",
    description: "Refresh tokens silently fail to rotate after 24h, forcing re-login.",
    status: "todo",
    priority: "high",
    storyPoints: 3,
    sprintId: sprint.id,
  });

  dependenciesRepo.addDependency(db, passwordRecovery.id, login.id);

  console.log("Seed complete:");
  console.log(`  Project: ${project.name} (${project.key}) [${project.id}]`);
  console.log(`  Sprint:  ${sprint.name} (active)`);
  console.log(
    `  Issues:  ${[epic, login, dashboard, passwordRecovery, billing, tokenBug]
      .map((i) => i.key)
      .join(", ")}`,
  );
  console.log(`  Dependency: ${passwordRecovery.key} depends on ${login.key}`);
  console.log("\nRun `pnpm dev` and open http://localhost:5174 to see the board.");
}

main();
