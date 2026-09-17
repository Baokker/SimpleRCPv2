import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createSharedTerminal } from "../sharedTerminal.js";
import { createTestWorkspace } from "./testWorkspace.js";

describe("shared terminal", () => {
  it("streams a real PTY and retains scrollback for later clients", async () => {
    const root = await createTestWorkspace("shared-terminal-");
    const terminal = createSharedTerminal({
      workspaceRoot: root,
      shell: "/bin/sh"
    });
    let output = "";
    const receivedMarker = new Promise<void>((resolve) => {
      terminal.onData((data) => {
        output += data;
        if (output.includes("shared-terminal-ok")) resolve();
      });
    });

    try {
      terminal.write("printf 'shared-terminal-ok\\n'\n");
      await receivedMarker;

      expect(output).toContain("shared-terminal-ok");
      expect(terminal.getScrollback()).toContain("shared-terminal-ok");
    } finally {
      terminal.dispose();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
