import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", exclude: ["bench/seeds/**", "node_modules/**", "dist/**"] }
});
