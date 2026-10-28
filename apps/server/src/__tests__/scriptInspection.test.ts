import path from "node:path";
import { describe, expect, it } from "vitest";
import { decide } from "../guard/decide.js";
import { applyScriptInspection, inspectScripts, type ScriptSource } from "../guard/scriptInspection.js";
import { writtenPaths } from "../guard/writeProvenance.js";
import type { GuardContext, GuardRequest, Level } from "../guard/types.js";

const workspace = "/workspace/project";
const context = (memberLevel: Level): GuardContext => ({ memberLevel, initiatorOnline: true, workspaceRoot: workspace, platformDataRoot: "/platform/data" });
const request = (text: string, source: GuardRequest["source"] = "terminal"): GuardRequest => ({ projectId: "project", memberId: "member", source, kind: "command", command: text, cwd: workspace });

function files(entries: Record<string, string>, writers: Record<string, Level> = {}): ScriptSource {
  const absolute = (relative: string) => path.join(workspace, relative);
  const contents = new Map(Object.entries(entries).map(([key, value]) => [absolute(key), value]));
  const levels = new Map(Object.entries(writers).map(([key, value]) => [absolute(key), value]));
  return { read: (file) => contents.get(file), writerLevel: (file) => levels.get(file) };
}

function judge(level: Level, text: string, source: ScriptSource, origin: GuardRequest["source"] = "terminal") {
  const base = decide(request(text, origin), context(level));
  return { base, final: applyScriptInspection(base, inspectScripts(request(text, origin), context(level), source), level, origin) };
}

describe("script inspection", () => {
  it("judges the commands inside a shell script before it runs", () => {
    const { base, final } = judge("student", "bash run.sh", files({ "run.sh": "#!/bin/sh\necho start\ncat ../outside/secret.txt\n" }));
    expect(base.action).toBe("allow");
    expect(final.action).toBe("ask");
    expect(final.approvers).toBe("owners");
    expect(final.autoEligible).toBe(false);
    expect(final.matchedRules).toContain("script.hard.outside");
  });

  it("follows cd inside a script", () => {
    const { final } = judge("collaborator", "sh clean.sh", files({ "clean.sh": "cd ../other\nrm -rf *\n" }));
    expect(final.action).toBe("ask");
  });

  it("expands package scripts and make recipes", () => {
    const source = files({
      "package.json": JSON.stringify({ scripts: { test: "vitest run", deploy: "git push origin main" } }),
      Makefile: "all: build\nbuild:\n\t@npx tsc -p .\nclean:\n\trm -rf ../outside\n"
    });
    expect(judge("collaborator", "npm test", source).final.action).toBe("allow");
    expect(judge("collaborator", "npm run deploy", source).final.action).toBe("ask");
    expect(judge("collaborator", "make", source).final.action).toBe("allow");
    expect(judge("collaborator", "make clean", source).final.action).toBe("ask");
  });

  it("scans interpreter scripts for paths, commands and dynamic code", () => {
    const source = files({
      "read.js": "const fs = require('fs');\nconsole.log(fs.readFileSync('../outside/secret.txt', 'utf8'));\n",
      "spawn.py": "import subprocess\nsubprocess.run('git push origin main', shell=True)\n",
      "build.js": "const fs = require('fs');\nfs.writeFileSync('dist/out.txt', fs.readFileSync('src/index.ts'));\n",
      "dyn.js": "eval(Buffer.from(process.argv[2], 'base64').toString());\n",
      "main.js": "require('./lib/helper');\n",
      "lib/helper.js": "require('fs').rmSync('../outside', { recursive: true });\n"
    });
    expect(judge("student", "node read.js", source).final.action).toBe("ask");
    expect(judge("collaborator", "python3 spawn.py", source).final.action).toBe("ask");
    expect(judge("student", "node build.js", source).final.action).toBe("allow_snapshot");
    expect(judge("collaborator", "node dyn.js", source).final.matchedRules).toContain("script.dynamic-code");
    expect(judge("owner", "node dyn.js", source).final.action).toBe("allow");
    expect(judge("student", "node main.js", source).final.action).toBe("ask");
  });

  it("judges a script at the level of its last writer", () => {
    const source = files({ "fix.sh": "rm -rf src\n" }, { "fix.sh": "student" });
    expect(judge("owner", "bash fix.sh", files({ "fix.sh": "rm -rf src\n" })).final.action).toBe("allow");
    const trojan = judge("owner", "bash fix.sh", source).final;
    expect(trojan.action).toBe("ask");
    expect(trojan.approvers).toBe("self");
    expect(trojan.matchedRules).toContain("script.writer.student");
    const packaged = files({ "package.json": JSON.stringify({ scripts: { fix: "rm -rf src" } }) }, { "package.json": "student" });
    expect(judge("owner", "npm run fix", packaged).final.action).toBe("ask");
  });

  it("leaves requests without readable scripts unchanged", () => {
    const { base, final } = judge("collaborator", "node script.js && npm test", files({}));
    expect(final).toEqual(base);
  });

  it("records the files a request writes", () => {
    expect(writtenPaths(request("echo x > run.sh && cp a.sh b.sh"))).toEqual([path.join(workspace, "run.sh"), path.join(workspace, "b.sh")]);
    expect(writtenPaths({ ...request(""), kind: "edit", paths: ["src/a.ts"] })).toEqual([path.join(workspace, "src/a.ts")]);
  });
});
