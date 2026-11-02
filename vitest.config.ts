import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["temp/**", "node_modules/**"],
    environment: "node",
    // Sign-in tests run real scrypt checks (tens per test), and CI runners and a loaded workstation are several times slower
    // than an idle one: 5 s failed them on time alone. A hung test still fails, just later.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
