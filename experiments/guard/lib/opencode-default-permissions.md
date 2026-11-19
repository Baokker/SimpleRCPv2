# OpenCode 1.18.31 默认权限依据

核对时间为 2026-10-06。版本由安装包 `apps/server/node_modules/opencode-ai/package.json` 记录。安装的 Mach-O executable 内嵌 Agent 默认配置，使用系统 `strings` 读取后核对。

```javascript
g=a.fromConfig({"*":"allow",doom_loop:"ask",external_directory:{"*":"ask",...Object.fromEntries(j.map((n)=>[n,"allow"]))},question:"deny",plan_enter:"deny",plan_exit:"deny",read:{"*":"allow","*.env":"ask","*.env.*":"ask","*.env.example":"allow"}})
```

| 请求 | 默认动作 |
|---|---|
| bash、edit、webfetch 与普通 read | allow |
| `.env` 与 `.env.*` read | ask |
| `.env.example` read | allow |
| external_directory | ask，工具输出和配置的临时位置具有 allow 例外 |
| doom_loop | ask |

B1 是静态规则模拟。数据集没有重复运行状态，因此不触发 doom_loop。外部目录的静态识别复用已配置夹具的路径刻画，报告说明该近似不能替代原生 OpenCode 的实际执行。B1 对终端来源统一 allow。文件路径与命令正文不进行真实攻击执行。

当前官方权限页面为 `https://opencode.ai/docs/permissions/`。版本证据以安装 executable 中的配置为准。B1 与其他条件均保留独立命中规则，默认允许危险命令的结果可以通过原始 JSONL 核对。
