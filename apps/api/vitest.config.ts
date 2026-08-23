import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Every suite here boots the whole Fastify app and runs migrations in its
    // `beforeAll`. That is a few seconds cold, and NEMO is developed on machines
    // that are also running the projects it manages -- vitest's 10s default
    // turns ordinary CPU contention into a phantom test failure.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
