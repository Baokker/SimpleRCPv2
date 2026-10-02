# 部署说明

平台仅用于受信的内部小规模实验与自测。服务端不做鉴权，知道 `memberId` 即可冒充成员，项目管理与全局 Agent 设置开放。不要部署到公网。

## 本机运行

安装 Node.js 20 以上与 pnpm 9，在仓库执行 `pnpm install`，参考 `.env.example` 设置环境变量。文件协作与共享终端无需模型 Key；Agent 使用 `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL` 和 `DEEPSEEK_MODEL`。

执行 `pnpm dev` 或 `pnpm dev:demo`，打开 `http://127.0.0.1:5173`，选择项目，输入显示名和可选 Role。Role 仅用于显示，成员能力相同。当前标签页使用 `sessionStorage` 保存 `memberId`，`localStorage` 只保存最近选择；刷新当前标签页会恢复原成员，新标签页可以选择其他成员或创建新成员。

## 内网服务器

只允许受信参与者访问服务器，设置 `SIMPLERCP_HOST=0.0.0.0`、`VITE_SIMPLERCP_CLIENT_HOST=0.0.0.0` 和 `SIMPLERCP_PUBLIC_URL=http://<内网地址>:5173`，执行 `pnpm dev`。参与者打开该地址后按本机方式加入。

构建使用 `pnpm build`。仓库提供 Vite 开发服务，持续运行需要部署环境提供静态文件服务、Node.js 进程管理和反向代理。代理转发 `/api`、`/ws`、`/yjs` 和启用时的 `/terminal`，为 WebSocket 保留 upgrade。可以在反向代理添加 basic auth。

## 数据与环境

- `SIMPLERCP_DATA_DIR`：绝对路径，默认仓库 `.simplercp-data/`。
- `SIMPLERCP_WORKSPACES_DIR`：绝对路径，默认数据目录下的 `workspaces/`。
- `SIMPLERCP_IMPORT_ROOTS`：可选的绝对路径根目录，逗号分隔。设置后检查 realpath；未设置或留空时允许导入服务端目录。
- `SIMPLERCP_TERMINAL_ENABLED=false`：关闭共享终端与 PTY。
- `SIMPLERCP_TERMINAL_HOME`：可选的终端专用 HOME。
- `SIMPLERCP_TERMINAL_ENV_ALLOW`、`SIMPLERCP_AGENT_ENV_ALLOW`：逗号分隔的额外环境变量名。
- `SIMPLERCP_OPENCODE_PORT`：OpenCode 回环端口，默认 `4096`。

元数据保存在 `projects/<id>/`，代码保存在 `workspaces/<id>/`。备份数据目录和外部工作区根目录。旧结构在启动时迁移，迁移标记位于 `instance/`；失败会终止启动，保留数据，修正路径或权限后重新启动。

终端只继承基本 shell 环境，名称包含 KEY、TOKEN、SECRET、PASSWORD、COOKIE 的变量始终过滤。OpenCode 额外得到模型配置变量，文件工具的 `external_directory` 为 `deny`。

## 已知局限

终端与 Agent 使用服务端系统用户，绝对路径仍能访问该用户可以读取的其他项目、元数据与仓库 `.env`。元数据外移仅阻止通过工作区上一级直接访问；没有 CPU、内存或进程数限制。

OpenCode `1.18.31` 的 bash 工具继承 Agent 环境，可能读取模型 Key；目前没有为 bash 单独配置环境的接口。后续 B3 应将 bash 改为 `ask`，由服务端处理审批。trace、活动和聊天保存前使用统一脱敏函数。

旧 session 中无法对应成员记录的条目标为历史记录。工作区迁移可能影响旧 OpenCode session 的目录关联，继续工作时创建新的 session。
