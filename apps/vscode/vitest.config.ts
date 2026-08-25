import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      // "vscode" is provided by the editor at runtime and does not exist on
      // disk, so extension code cannot be imported in a test without a stand-in.
      // This is the seam that makes the extension's own logic testable at all.
      vscode: path.resolve(__dirname, "test/vscode-stub.ts"),
    },
  },
});
