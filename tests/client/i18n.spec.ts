import { expect, test } from "@playwright/test";
import { en } from "../../apps/client/src/i18n/en";
import { serverText, systemMessageText, translator } from "../../apps/client/src/i18n/messages";
import { zh } from "../../apps/client/src/i18n/zh";

test("中英文词典包含相同的键和插值参数，每项都有文案", () => {
  const keys = Object.keys(zh) as Array<keyof typeof zh>;
  expect(Object.keys(en).sort()).toEqual([...keys].sort());

  function parameters(message: string) {
    return [...new Set([...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))].sort();
  }

  for (const key of keys) {
    expect(zh[key].trim(), key).not.toBe("");
    expect(en[key].trim(), key).not.toBe("");
    expect(parameters(en[key]), key).toEqual(parameters(zh[key]));
  }
});

test("整句插值保留原始路径及零值", () => {
  const chinese = translator("zh-CN");
  const english = translator("en");
  const paths = { from: "src/{old}.ts", to: "src/新文件.ts" };

  expect(chinese("pathRenamed", paths)).toBe("src/{old}.ts 已重命名为 src/新文件.ts");
  expect(english("pathRenamed", paths)).toBe("src/{old}.ts was renamed to src/新文件.ts");
  expect(chinese("seconds", { count: 0 })).toBe("0 秒");
});

test("服务端错误按界面语言显示，OpenCode 诊断中的原始信息可以查阅", () => {
  const chinese = translator("zh-CN");
  const english = translator("en");

  expect(serverText(chinese, "Existing project path must be absolute")).toBe("已有项目的路径必须是绝对路径");
  expect(serverText(chinese, "Team Agent handle already exists: review-1")).toBe("已存在团队 Agent @review-1");
  expect(serverText(english, "Team Agent handle already exists: review-1")).toBe("Team Agent @review-1 already exists");
  expect(serverText(chinese, "OpenCode did not start within 15 seconds")).toBe("OpenCode 未能在 15 秒内启动");
  expect(serverText(chinese, "OpenCode version 1.18.31 is required, received 1.18.30")).toBe("OpenCode 需要版本 1.18.31，当前版本为 1.18.30");
  expect(serverText(chinese, "OpenCode exited during startup with code 1")).toBe("OpenCode 在启动时退出，退出码为 1");
  expect(serverText(chinese, "OpenCode exited during startup with code null")).toBe("OpenCode 在启动时终止");
  expect(serverText(chinese, "OpenCode could not start: spawn opencode ENOENT")).toBe("OpenCode 无法启动：spawn opencode ENOENT");
  expect(serverText(chinese, "Service provider returned an unrecognized response")).toBe("Service provider returned an unrecognized response");
});

test("已保存的团队 Agent 通知保留成员名、Agent 标识及错误详情", () => {
  const chinese = translator("zh-CN");
  const english = translator("en");
  const interrupted = "林 Wei interrupted @review-1's task started by O'Connor";
  const failure = "Unable to start the team Agent: Agent is disabled";

  expect(systemMessageText(chinese, interrupted)).toBe("林 Wei 中断了由 O'Connor 发起的 @review-1 任务");
  expect(systemMessageText(english, interrupted)).toBe(interrupted);
  expect(systemMessageText(chinese, failure)).toBe("无法启动团队 Agent：Agent 已停用");
  expect(systemMessageText(english, failure)).toBe(failure);
  expect(systemMessageText(chinese, "Unable to start the team Agent: Unable to start the team Agent")).toBe("无法启动团队 Agent");
});
