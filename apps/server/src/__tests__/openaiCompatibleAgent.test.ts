import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runOpenAICompatibleAgentTask } from "../agents/openaiCompatible.js";
import { createEventLog } from "../eventLog.js";
import { createTaskStore } from "../tasks.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "simplercp-openai-agent-"));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(
    path.join(root, "src", "hello.ts"),
    "export const hello = 'world';\n"
  );
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      scripts: {
        test: "node -e \"console.log('provider-test-ok')\""
      }
    })
  );
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("OpenAI-compatible agent", () => {
  it("calls chat completions and records a final report", async () => {
    const events = createEventLog();
    const tasks = createTaskStore(events);
    const task = tasks.createTask({
      roomId: "room-1",
      title: "Review greeting",
      description: "Check whether the greeting needs a change.",
      creatorId: "human-1",
      assigneeId: "agent-1",
      editablePaths: ["src/**"],
      commandWhitelist: ["npm test"],
      acceptanceTarget: "Report status"
    });
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fakeFetch = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  actions: [
                    { type: "message", text: "I will inspect the task." },
                    {
                      type: "final_report",
                      summary: "No file change needed.",
                      commands: [],
                      risks: []
                    }
                  ]
                })
              }
            }
          ]
        }),
        { status: 200 }
      );
    };

    const report = await runOpenAICompatibleAgentTask(
      {
        workspaceRoot: root,
        events,
        tasks,
        taskId: task.id,
        agentId: "agent-1"
      },
      {
        provider: "openai-compatible",
        baseUrl: "https://api.deepseek.com",
        apiKey: "test-key",
        model: "deepseek-v4-flash",
        name: "DeepSeek",
        mentionAliases: ["DeepSeek"],
        editablePaths: ["src/**"]
      },
      fakeFetch
    );

    const call = calls[0];
    if (!call) {
      throw new Error("Expected provider fetch to be called");
    }
    expect(call.url).toBe("https://api.deepseek.com/chat/completions");
    expect(call.init?.headers).toMatchObject({
      Authorization: "Bearer test-key",
      "Content-Type": "application/json"
    });
    expect(JSON.parse(String(call.init?.body))).toMatchObject({
      model: "deepseek-v4-flash"
    });
    expect(report.summary).toBe("No file change needed.");
    expect(events.list().map((event) => event.type)).toEqual(
      expect.arrayContaining(["agent_message", "agent_reported"])
    );
  });

  it("validates requested edits and commands against task authorization", async () => {
    const events = createEventLog();
    const tasks = createTaskStore(events);
    const task = tasks.createTask({
      roomId: "room-1",
      title: "Update greeting",
      description: "Make a safe edit and run tests.",
      creatorId: "human-1",
      assigneeId: "agent-1",
      editablePaths: ["src/**"],
      commandWhitelist: ["npm test"],
      acceptanceTarget: "Tests pass"
    });
    const fakeFetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  actions: [
                    {
                      type: "edit_file",
                      path: "README.md",
                      content: "# blocked\n"
                    },
                    {
                      type: "run_command",
                      command: "rm -rf ."
                    },
                    {
                      type: "edit_file",
                      path: "src/hello.ts",
                      content: "export const hello = 'provider';\n"
                    },
                    { type: "run_command", command: "npm test" },
                    {
                      type: "final_report",
                      summary: "Updated greeting and ran tests.",
                      commands: ["npm test"],
                      risks: []
                    }
                  ]
                })
              }
            }
          ]
        }),
        { status: 200 }
      );

    const report = await runOpenAICompatibleAgentTask(
      {
        workspaceRoot: root,
        events,
        tasks,
        taskId: task.id,
        agentId: "agent-1"
      },
      {
        provider: "openai-compatible",
        baseUrl: "https://api.deepseek.com",
        apiKey: "test-key",
        model: "deepseek-v4-flash",
        name: "DeepSeek",
        mentionAliases: ["DeepSeek"],
        editablePaths: ["src/**"]
      },
      fakeFetch
    );

    await expect(fs.readFile(path.join(root, "src", "hello.ts"), "utf8")).resolves.toBe(
      "export const hello = 'provider';\n"
    );
    expect(report.commands).toEqual(["npm test"]);
    expect(events.list().map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "approval_requested",
        "agent_edited_file",
        "command_completed",
        "agent_reported"
      ])
    );
  });

  it("records invalid provider actions without crashing the run", async () => {
    const events = createEventLog();
    const tasks = createTaskStore(events);
    const task = tasks.createTask({
      roomId: "room-1",
      title: "Update greeting",
      description: "Make a safe edit and run tests.",
      creatorId: "human-1",
      assigneeId: "agent-1",
      editablePaths: ["src/**"],
      commandWhitelist: ["npm test"],
      acceptanceTarget: "Tests pass"
    });
    const fakeFetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  actions: [
                    {
                      type: "edit_file",
                      content: "export const hello = 'missing-path';\n"
                    },
                    {
                      type: "run_command"
                    },
                    {
                      type: "final_report",
                      summary: "I tried to update the project.",
                      commands: [],
                      risks: []
                    }
                  ]
                })
              }
            }
          ]
        }),
        { status: 200 }
      );

    const report = await runOpenAICompatibleAgentTask(
      {
        workspaceRoot: root,
        events,
        tasks,
        taskId: task.id,
        agentId: "agent-1"
      },
      {
        provider: "openai-compatible",
        baseUrl: "https://api.deepseek.com",
        apiKey: "test-key",
        model: "deepseek-v4-flash",
        name: "DeepSeek",
        mentionAliases: ["DeepSeek"],
        editablePaths: ["src/**"]
      },
      fakeFetch
    );

    await expect(fs.readFile(path.join(root, "src", "hello.ts"), "utf8")).resolves.toBe(
      "export const hello = 'world';\n"
    );
    expect(report.summary).toBe("I tried to update the project.");
    expect(report.risks).toEqual(
      expect.arrayContaining([
        "Skipped edit_file action because path must be a non-empty string.",
        "Skipped run_command action because command must be a non-empty string."
      ])
    );
    expect(events.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "agent_error",
          payload: {
            message: "Skipped edit_file action because path must be a non-empty string."
          }
        }),
        expect.objectContaining({
          type: "agent_error",
          payload: {
            message: "Skipped run_command action because command must be a non-empty string."
          }
        })
      ])
    );
  });
});
