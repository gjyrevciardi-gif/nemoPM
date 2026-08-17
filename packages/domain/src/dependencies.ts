import { dependenciesRepo } from "@ai-pm/database";

export const { addDependency, removeDependency, listDependencies, listDependenciesForProject } = dependenciesRepo;
