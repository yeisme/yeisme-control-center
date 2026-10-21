import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["temp/**", "node_modules/**"],
    environment: "node",
  },
});
