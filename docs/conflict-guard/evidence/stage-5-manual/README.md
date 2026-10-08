# 浏览器验收证据

两个真实浏览器上下文以 Alice、Bob 加入同一 conflict-shop。normal.json 保存黄色分析、双方解释、建议与统计断言，cancel.json 保存修订取消结果。failure-G3.json 检查两个角色均失败，failure-G2.json 检查快判单独失败。PNG 记录对应页面状态。

`verification.json` 保存完整浏览器回归、off/observe/rules 协作测试及实际模型验收结果。验证使用 DOM、Monaco、服务端状态与轨迹，普通 CI 跳过实际模型调用。可执行 `node scripts/verify-stage5-browser.mjs` 重新运行；该命令会进行实际模型调用。

2026-10-08 的界面回归重新生成 `normal.json`、`cancel.json`、`failure-G2.json` 及对应截图，本轮结果见 `../ui-round1/verification.json`。`failure-G3.json` 与 `verification.json` 保留阶段五验收时的记录。
