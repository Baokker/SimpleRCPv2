# G3a 级联录制

本目录保留阶段 A3 的早期探索材料，不能作为最终候选结果。正式结果位于 `../G3a-final/`。

正式 `G3a-final` 在 D1-v4 开发集上完成 90 次 Jev 快判和 6 次 MiniMax-M3 深判，快判与深判均为有效返回。Jev 使用 `TYPESAFE_PROXY_URL` 指向本机代理，固定模型为 `jev-1.13.0`；MiniMax 使用 `https://api.minimaxi.com/v1` 的 `MiniMax-M3` 直连。正式结果的总费用约为 `$0.02701`。

最终候选选择使用 `selection-result.json`，其中 G3a 通过模型请求有效率和安全修改误拦率筛选，并以 92.64% 的平衡准确率进入 P4。
