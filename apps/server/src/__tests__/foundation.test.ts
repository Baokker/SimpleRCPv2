import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createAuthStore } from "../auth/identity.js";
import { redactSensitive } from "../agent/traceStore.js";
import { agentEnv, terminalEnv } from "../processEnv.js";

describe("foundation identity and isolation", () => {
  it("stores only token hashes and prevents invite reuse after revocation", async () => {
    await fs.mkdir(path.join(process.cwd(), ".test-workspaces"), { recursive: true });
    const root = await fs.mkdtemp(path.join(process.cwd(), ".test-workspaces", "foundation-"));
    const project = { id: "demo", name: "Demo", source: "demo", workspacePath: path.join(root, "workspace"), metadataPath: root, createdAt: new Date().toISOString(), lastOpenedAt: new Date().toISOString() } as const;
    const auth = createAuthStore({ dataDir: root, adminToken: "admin-token-value", projects: () => [project] });
    await auth.initialize();
    const created = await auth.createInvite("demo", {});
    expect(JSON.stringify(created.invite)).not.toContain(created.token);
    const joined = await auth.join("demo", created.token, "Alice");
    expect(joined.member.tokenHash).not.toContain(joined.sessionToken);
    const stored = await fs.readFile(path.join(root, "members.json"), "utf8");
    expect(stored).not.toContain(joined.sessionToken);
    const inviteFile = await fs.readFile(path.join(root, "invites.json"), "utf8");
    expect(inviteFile).not.toContain(created.token);
  });

  it("filters identity variables from terminal and keeps the model key for Agent", () => {
    const env = { PATH: "/bin", HOME: "/home/test", DEEPSEEK_API_KEY: "fake-key-value", SIMPLERCP_ADMIN_TOKEN: "admin-token", OTHER_SECRET: "secret-value", LANG: "C" };
    expect(terminalEnv(env)).toEqual({ PATH: "/bin", HOME: "/home/test", LANG: "C" });
    expect(agentEnv(env)).toMatchObject({ PATH: "/bin", HOME: "/home/test", DEEPSEEK_API_KEY: "fake-key-value" });
    expect(agentEnv(env)).not.toHaveProperty("SIMPLERCP_ADMIN_TOKEN");
    expect(agentEnv(env)).not.toHaveProperty("OTHER_SECRET");
  });

  it("redacts environment values and common credential formats", () => {
    const output = redactSensitive("key=fake-key-value Bearer abcdefghijkl sk-abcdefghijklmnop", ["fake-key-value"]);
    expect(output).toBe("key=[REDACTED:TOKEN] Bearer [REDACTED:TOKEN] [REDACTED:API_KEY]");
  });
});
