# 冲突预防面板：说明、列表与筛选

日期：2026-10-09。分支：`feature/conflict-guard`。代码基准：`e2c0584`。

## 首屏

“这个面板在做什么”默认展开，逐行说明白区、黑区、灰区，以及人与 Agent 的处理方式。说明使用固定中文文案，展开状态保存到浏览器本地存储。

说明下方显示白区、黑区、灰区、判定次数和打扰次数。分区数量包含人的判定与 Agent 写入前、任务完成后的检查结果，使用完整数据计算，列表筛选和数量限制只影响展示。

“需要你处理”紧接统计，保持展开。本人参与的冻结变更对和等待本人处理的属主卡片出现在这里。没有处理事项时显示明确的提示。第三位成员可以从检查记录查看冲突；处理按钮提供给相关成员。本人采纳建议后，意图板显示等待对方的状态。

## 修改与记录

“正在进行的修改与关联关系”默认收起，摘要显示人数、Agent 数量、符号数量和关联组数。展开后可以查看意图板、正在修改的符号和相互关联的修改。三个列表各有计数，默认显示前 10 条，提供“显示全部”和“收起列表”。计划与实际范围也有数量限制。

“检查记录与统计”默认收起。检查记录按更新时间倒序排列，默认显示最近 20 条，每次“显示更多”增加 20 条。记录头部显示时间、中文检查类型、处理结果和文件与符号，详细说明通过点击展开。详细统计与文件写入状态各自可以展开。“导出轨迹”下载完整的项目轨迹。

## 筛选与文案

正在修改、关联修改、检查记录各自提供“全部／人之间／人与 Agent／Agent 之间”按钮和“只看与我相关”。类型可以多选，先筛选再限制数量。修改列表按参与者及簇内符号匹配关联；本人筛选包含本人 Agent 和相关对手的符号。没有关联的修改仍可在“全部”中查看。

筛选、展开状态和列表数量按项目及成员保存，切换页签或刷新页面后继续使用。

中文规则短语集中在 [conflictGuardLabels.ts](../../apps/client/src/conflictGuardLabels.ts)。例如“改了函数签名”“删了别人还在用的导出”“只改了日志”“改的是同一个函数的不同位置”。新增标识缺少映射时显示原文并标记“未翻译”。原始检查标识、规则标识和变更对标识位于默认收起的“技术细节（调试信息）”。个人 Agent 面板及任务记录也使用中文检查名称。

## 主题与浏览器验证

字号、背景、边框和按钮沿用协作面板的主题变量。白区使用中性色，灰区使用警示黄，黑区使用警示红。

浏览器用例覆盖以下内容：

- 1280×720 窗口中的说明、统计和待处理标题同时可见；深浅主题均检查文字对比度，要求至少 4.5:1。
- 三个独立浏览器会话通过真实 Monaco 与 Yjs 产生 24 条符号修改和 12 组关联，验证前 10 条、显示全部、筛选计数、本人筛选、页签状态保持和轨迹下载。
- 原始真实并发轨迹的 779 条归档记录用于只读界面验证：三种双方类型分别为 6、221、552 条，分页从 20 条增加到 40 条，顺序及中文映射通过检查。
- 两份阶段七真实 Agent 验收归档验证顶部统计包含 Agent 黑区与灰区结果。

截图与原始验证数据位于 [ui-information](evidence/ui-information/)。截图依据页面尺寸和浏览器计算样式验证，保存深色、浅色两张首屏图片。本轮使用已保存的真实 Agent 记录，新增 Agent run 和模型调用均为 0。

人工操作见 [manual-acceptance.md 第 5.6 节](manual-acceptance.md#56-首次使用列表与筛选)。

## 验证结果与复现

最终源码的 `pnpm -r build` 通过。浏览器回归共 20 项，全部通过，覆盖本次信息分层、阶段三冻结与确认、观察成员的检查记录、界面回放以及冲突卡片和编辑器横幅。

在仓库根目录执行：

```bash
pnpm -r build

SIMPLERCP_LIVE_AGENT_TESTS=0 \
SIMPLERCP_SKIP_MODEL_REQUESTS=true \
CONFLICT_GUARD=rules \
CONFLICT_GUARD_PROVIDER_MODE=replay \
pnpm test:e2e \
  tests/e2e/conflict-guard-information.spec.ts \
  tests/e2e/conflict-guard-ui.spec.ts \
  tests/e2e/conflict-guard-panel.spec.ts \
  tests/e2e/conflict-guard-intervention.spec.ts \
  tests/e2e/conflict-guard-checkpoint.spec.ts \
  tests/e2e/conflict-guard-replay.spec.ts
```

构建与浏览器原始输出保存为 [build.log](evidence/ui-information/build.log) 和 [playwright.log](evidence/ui-information/playwright.log)。深浅主题首屏的尺寸、文字对比度与说明状态验证记录见 [first-screen.json](evidence/ui-information/first-screen.json)，实际协作列表验证见 [collaboration.json](evidence/ui-information/collaboration.json)，归档分页与筛选验证见 [archive.json](evidence/ui-information/archive.json)。

环境密钥精确值检查结果为 `configuredValuesFound: 0`，`git diff --check` 通过。

新增规则缺少中文映射时，界面显示原始标识并附“未翻译”；可以从集中映射表补充对应短语。
