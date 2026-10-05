import { describe, expect, it } from "vitest";
import { generateManifest } from "./generator.js";
import { labelManifest } from "./labeler.js";

describe("阶段 4 基准生成", () => {
  it("固定种子生成逐字节相同的关系组", () => {
    const projects = [{ name: "seed", files: { "src/base.ts": "export const base = 1;" } }];
    const first = generateManifest({ projects, groups: 6, seed: 19 });
    const second = generateManifest({ projects, groups: 6, seed: 19 });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("每个关系组包含冲突变体与安全孪生，标签包含四种状态重复执行", () => {
    const manifest = generateManifest({ projects: [{ name: "seed", files: {} }], groups: 4, seed: 2 });
    const result = labelManifest(manifest);
    expect(result.excluded).toHaveLength(0);
    expect(result.labels).toHaveLength(8);
    expect(result.labels.every((label) => Object.values(label.states).every((runs) => runs.length === 3))).toBe(true);
    expect(manifest.groups.every((group) => group.variants.conflict.trace.length > 0 && group.variants.safe.trace.length > 0)).toBe(true);
  });
});

