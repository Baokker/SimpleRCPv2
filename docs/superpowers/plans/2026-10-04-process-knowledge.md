# Process Knowledge Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 SimpleRCPv2 中加入可独立测试的 `@simplercp/knowledge` 包，移植旧过程性知识能力、升级 schema v3、提供 OpenAI 兼容调用与检索注入接口，并解析 `KNOWLEDGE` 服务端开关。

**Architecture:** 新包只依赖 Node 标准库与共享类型，按 schema、锚点、触发、视图、抽取、检索、注入、LLM、演示数据分模块。卡片读入通过 v1/v2 迁移函数转换为 v3；检索接受显式卡片或目录，默认使用 `isReusable` 门控。服务端只在配置层解析并打印开关，不连接知识服务。

**Tech Stack:** TypeScript ESM、Node 20、pnpm workspace、Vitest、Node fetch/http。

**Spec:** 用户提供的阶段 1 任务说明；设计依据为 `/Users/baokker/Work/毕业论文/projects/04-点三_过程性知识/方案设计.md` 与 `资料/代码调研_20261004.md`。

## Global Constraints

- 只修改 `/Users/baokker/Work/Master/CSCW/过程性知识管理/code/SimpleRCPv2`。
- 不读取或输出 `.env` 内容，不引入 `ai`、`@ai-sdk/*` 或其他 LLM SDK。
- 包内业务时间通过注入的 `now()`，测试与 benchmark 计时可以读取系统时间。
- `KNOWLEDGE` 只允许 `off`、`capture`、`inject`、`full`，默认 `off`，非法值启动报错。
- 旧算法、阈值、提示词、排序保持一致；迁移差异写入阶段报告。

### Task 1: Prepare baseline

- [ ] 从 `main` 创建 `feature/process-knowledge`。
- [ ] 复制点二 `.env` 到根目录并确认 Git 忽略。
- [ ] 安装依赖并运行 build、unit、e2e，记录完整结果。

### Task 2: Scaffold package and schema

- [ ] 创建包配置、TypeScript 配置、Vitest 配置与目录。
- [ ] 先移植 schema 守卫测试，再实现 v3 类型、迁移、确认、作用域门控和演化函数。
- [ ] 运行包测试与编译。

### Task 3: Port deterministic knowledge modules

- [ ] 移植锚点解析、锚点复核、触发策略、视图、hash、demo cards。
- [ ] 使用本包的 `TextRange`，保留算法和阈值。
- [ ] 移植旧 knowledge 测试与锚点 benchmark。

### Task 4: Add LLM and extraction modules

- [ ] 实现 `LlmClient` 与 fetch OpenAI 兼容客户端，覆盖聊天、embedding、超时、错误和 response format。
- [ ] 移植抽取、refine、prompt，去掉环境变量读取并保留三次尝试、引用校验和确定性兜底。
- [ ] 为 HTTP 客户端和解析函数添加真实本地 HTTP 测试。

### Task 5: Port retrieval and injection

- [ ] 移植词法索引、目录读取、显式卡片、内容 hash 缓存和可选 embedding。
- [ ] 实现过滤、`isReusable` 默认门控、类型优先级与字符预算结构化输出。
- [ ] 移植检索、规模、缓存、状态门控和触发回放测试与可复现实验入口。

### Task 6: Integrate server feature flag

- [ ] 在 `apps/server/src/config.ts` 解析 `KNOWLEDGE` 并在启动日志打印。
- [ ] 更新 `.env.example` 与 server workspace 依赖声明及锁文件。
- [ ] 补配置单测，确认 `off` 下现有行为保持。

### Task 7: Documentation and verification

- [ ] 编写 package README、`docs/knowledge/v0-parity.md`、`docs/knowledge/stage-1.md`。
- [ ] 运行 package build、根 build、根 test、e2e 与 benchmark，记录通过、失败、跳过和差异。
- [ ] 依据 verification-before-completion 重新检查 diff、敏感信息、依赖与日期时间调用。
