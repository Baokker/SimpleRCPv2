# RQ3 补充实验 · 阶段 1 知识库扩充

阶段 1 只生成数据，不调用 Agent 或 MiniMax-M3。平台分支为 `experiment/r4-context`，起点提交为 `7f91f7cc9b2666017a01228a201457be91b0540d`。数据分支为 `r4-scaled-kb`，起点提交为 `ea11a85ed344c522fe3b63288cd8577c94fa6498`。数据工作区为 `/Users/baokker/Work/Master/CSCW/过程性知识管理/code/knowledge-bench-r4`。

## 生成命令

```sh
git -C '/Users/baokker/Work/Master/CSCW/过程性知识管理/code/knowledge-bench' rev-parse HEAD
git -C '/Users/baokker/Work/Master/CSCW/过程性知识管理/code/knowledge-bench-r4' rev-parse HEAD
node scripts/generate-scaled-cards.mjs
node tools/freeze-manifest.mjs
node tools/validate.mjs
```

`generate-scaled-cards.mjs` 从现有 `library.json` 保留两个项目各 40 张 reviewed 卡片。新增部分的四分之一为同模块或同术语卡片，四分之三为无关卡片。内容使用固定中文模板，anchor 沿用对应夹具源码的已有 symbol 快照，未调用模型。生成结果位于数据仓库 `trapbench/cards/library-200.json` 和 `trapbench/cards/library-500.json`，报告位于同目录的两个 `library-*.report.json`。

## 数量与字符数

| 规模 | R1 卡片 | R2 卡片 | 每项目新增 | 每项目同模块或同术语 | 每项目无关 | 卡片 content 字符数 | AGENTS.md 导出字符数 | 估算 token 数 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 200 | 200 | 200 | 160 | 40 | 120 | 36,867 | 72,984 | 18,246 |
| 500 | 500 | 500 | 460 | 115 | 345 | 87,267 | 179,338 | 44,835 |

估算 token 数按字符数除以 4 后向上取整。卡片 JSON 文件总字符数分别为 1,199,438 和 3,020,012。两个规模都保留原始 40 张卡片，5 张目标卡片的对象内容和 ID 均通过逐项相等检查。

## 自动检查

- 两个规模各项目数量正确，卡片 ID 无重复。
- 所有卡片通过 `isKnowledgeCard` schema 检查。
- 原始 40 张 reviewed 卡片逐项保留。
- 5 张目标卡片逐项保留。
- 新卡片正文检查目标卡片标题、摘要、正文关键句，未发现目标约定文本。
- 数据仓库 `manifest.json` 已更新，提交前文件数为 2,212，manifest SHA-256 为 `6429ccf42a9586788a2486dab87cf604db1ca5fd6287203dcf2b35728e3ed008`。

完整 `node tools/validate.mjs` 在 R2 项目测试阶段终止，原因是夹具依赖 `nanoid` 未安装。失败输出保存在数据工作区 `.judge-work/r4/validate.log`。新增卡片 schema、数量、重复、基线和目标卡片检查已独立通过。

## 20 张新增干扰卡片抽样

抽样来自 `library-200.report.json` 和 `library-500.report.json` 的 `sample`，两种规模使用相同前 20 张同模块或同术语卡片。

| 项目 | ID | 类型 | 标题 | anchor |
| --- | --- | --- | --- | --- |
| R1 | `R1-R4-D001` | constraint | 模块记录规范 1 | `src/services/inventory-service.ts` |
| R1 | `R1-R4-D002` | risk | 模块记录规范 2 | `src/services/inventory-service.ts` |
| R1 | `R1-R4-D003` | context | 模块记录规范 3 | `src/services/inventory-service.ts` |
| R1 | `R1-R4-D004` | decision | 模块记录规范 4 | `src/services/inventory-service.ts` |
| R1 | `R1-R4-D005` | constraint | 模块记录规范 5 | `src/services/inventory-service.ts` |
| R1 | `R1-R4-D006` | risk | 模块记录规范 6 | `src/services/inventory-service.ts` |
| R1 | `R1-R4-D007` | context | 模块记录规范 7 | `src/services/inventory-service.ts` |
| R1 | `R1-R4-D008` | decision | 模块记录规范 8 | `src/services/inventory-service.ts` |
| R1 | `R1-R4-D009` | constraint | 模块记录规范 9 | `src/services/inventory-service.ts` |
| R1 | `R1-R4-D010` | risk | 模块记录规范 10 | `src/services/inventory-service.ts` |
| R2 | `R2-R4-D001` | constraint | 模块记录规范 1 | `src/extracted/agent/traceStore.ts` |
| R2 | `R2-R4-D002` | risk | 模块记录规范 2 | `src/extracted/agent/traceStore.ts` |
| R2 | `R2-R4-D003` | context | 模块记录规范 3 | `src/extracted/agent/traceStore.ts` |
| R2 | `R2-R4-D004` | decision | 模块记录规范 4 | `src/extracted/agent/traceStore.ts` |
| R2 | `R2-R4-D005` | constraint | 模块记录规范 5 | `src/extracted/agent/traceStore.ts` |
| R2 | `R2-R4-D006` | risk | 模块记录规范 6 | `src/extracted/agent/traceStore.ts` |
| R2 | `R2-R4-D007` | context | 模块记录规范 7 | `src/extracted/agent/traceStore.ts` |
| R2 | `R2-R4-D008` | decision | 模块记录规范 8 | `src/extracted/agent/traceStore.ts` |
| R2 | `R2-R4-D009` | constraint | 模块记录规范 9 | `src/extracted/agent/traceStore.ts` |
| R2 | `R2-R4-D010` | risk | 模块记录规范 10 | `src/extracted/agent/traceStore.ts` |

本阶段没有 Agent 运行，因此没有 `raw/` 记录。后续阶段的每次运行将保留 `raw/`，包含注入内容、Agent 输出摘要和判定详情。
