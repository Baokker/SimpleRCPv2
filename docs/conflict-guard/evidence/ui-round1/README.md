# 界面截图

截图使用两个独立 Chromium 上下文，分别以 Alice 和 Bob 登录。页面尺寸为 1600 × 1000，使用 `rules` 模式。修改前截图对应 `9365ee9`，修改后截图对应实现提交 `0b884a0689ad47d0c91a004912d3980f5951e90d`。完整验证索引见 [verification.json](verification.json)。

| 内容 | 修改前 | 修改后 |
|---|---|---|
| 完整页面 | [before-overview.png](before-overview.png) | [after-overview.png](after-overview.png) |
| 冲突卡片 | [before-card.png](before-card.png) | [after-card.png](after-card.png) |
| 关联修改 | [before-related.png](before-related.png) | [after-related.png](after-related.png) |
| 页签与角标 | [before-tabs.png](before-tabs.png) | [after-tabs.png](after-tabs.png) |
| 编辑器横幅 | [before-banner.png](before-banner.png) | [after-banner.png](after-banner.png) |

修改后的截图由 `tests/e2e/conflict-guard-ui.spec.ts` 生成。该用例通过 DOM 和实际元素尺寸检查角标数量、操作顺序、按钮宽度与高度、卡片标签、代码展开、横幅位置、确认与撤回结果。

复现命令在仓库根目录执行：

```bash
CONFLICT_GUARD=rules SIMPLERCP_E2E_SERVER_PORT=4200 SIMPLERCP_E2E_CLIENT_PORT=5184 SIMPLERCP_UI_EVIDENCE=after pnpm test:e2e tests/e2e/conflict-guard-ui.spec.ts
```

运行时需要两个端口空闲。该用例使用真实编辑器与 Yjs 服务，不启动 Agent，不请求模型。
