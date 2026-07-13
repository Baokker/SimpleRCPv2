import os from "node:os";
import { describe, expect, it } from "vitest";
import { createSharedTerminal } from "../sharedTerminal.js";

describe("shared terminal", () => {
  it("streams a real PTY and retains scrollback for later clients", async () => {
    const terminal = createSharedTerminal({
      workspaceRoot: os.tmpdir(),
      shell: "/bin/sh"
    });
    let output = "";
    const receivedMarker = new Promise<void>((resolve) => {
      terminal.onData((data) => {
        output += data;
        if (output.includes("shared-terminal-ok")) resolve();
      });
    });

    terminal.write("printf 'shared-terminal-ok\\n'\n");
    await receivedMarker;

    expect(output).toContain("shared-terminal-ok");
    expect(terminal.getScrollback()).toContain("shared-terminal-ok");
    terminal.dispose();
  });
});
