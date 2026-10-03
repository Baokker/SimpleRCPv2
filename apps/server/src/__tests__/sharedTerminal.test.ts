import fs from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { createSharedTerminal } from "../sharedTerminal.js";
import { createTestWorkspace } from "./testWorkspace.js";

describe("shared terminal", () => {
  it("stays inactive when disabled", async () => {
    const root = await createTestWorkspace("disabled-terminal-");
    const terminal = createSharedTerminal({
      workspaceRoot: root,
      shell: "/path/that/does/not/exist",
      enabled: false
    });

    try {
      expect(terminal.enabled).toBe(false);
      terminal.write("echo unavailable\n", "member-disabled");
      terminal.resize(80, 24);
      terminal.restart();
      expect(terminal.getScrollback()).toBe("");
    } finally {
      terminal.dispose();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

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
      expect(terminal.foregroundProcess()).toBeTruthy();
      expect(terminal.isShellProcess(terminal.foregroundProcess()!)).toBe(true);
      expect(terminal.isShellProcess("bash")).toBe(true);
      expect(terminal.isShellProcess("sleep")).toBe(false);
      terminal.write("printf 'shared-terminal-ok\\n'\n", "member-pty");
      await receivedMarker;

      expect(output).toContain("shared-terminal-ok");
      expect(terminal.getScrollback()).toContain("shared-terminal-ok");
    } finally {
      terminal.dispose();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("runs a shell without sensitive environment variables even when explicitly allowed", async () => {
    const root = await createTestWorkspace("terminal-env-");
    const names = ["DEEPSEEK_API_KEY", "TEST_TOKEN", "TEST_SECRET", "TEST_KEY", "SIMPLERCP_TERMINAL_ENV_ALLOW"];
    const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    process.env.DEEPSEEK_API_KEY = "test-model-key-value";
    process.env.TEST_TOKEN = "test-token-value";
    process.env.TEST_SECRET = "test-secret-value";
    process.env.TEST_KEY = "test-key-value";
    process.env.SIMPLERCP_TERMINAL_ENV_ALLOW = names.join(",");
    const terminal = createSharedTerminal({ workspaceRoot: root, shell: "/bin/sh" });
    try {
      terminal.write("env > terminal-env.txt\n", "member-env");
      await vi.waitFor(async () => expect(await fs.readFile(`${root}/terminal-env.txt`, "utf8")).toContain("PATH="));
      const output = await fs.readFile(`${root}/terminal-env.txt`, "utf8");
      for (const name of names.slice(0, 4)) expect(output).not.toContain(`${name}=`);
    } finally {
      terminal.dispose();
      for (const name of names) {
        if (previous[name] === undefined) delete process.env[name];
        else process.env[name] = previous[name];
      }
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
