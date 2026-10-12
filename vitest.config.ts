import { defineConfig } from "vitest/config";

// Unit tests for the PDF operations (pure TS, no browser or Tauri needed).
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
