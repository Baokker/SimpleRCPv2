import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    include: ["src/**/*.test.ts"],
    fileParallelism: false
  }
});
