import { expect, test } from "@playwright/test";
import { en } from "../../apps/client/src/i18n/en";
import { translator } from "../../apps/client/src/i18n/messages";
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
