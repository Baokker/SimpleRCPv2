# 部署说明

服务端通过 `SIMPLERCP_PUBLIC_URL` 确定浏览器来源，并通过 `SIMPLERCP_ALLOWED_ORIGINS` 添加额外来源。公网部署应当使用 HTTPS 反向代理，并把 `/api`、`/ws`、`/yjs` 和启用时的 `/terminal` 转发到 Node 服务。

管理员令牌可以通过 `SIMPLERCP_ADMIN_TOKEN` 提供。未提供时，服务端首次启动生成令牌并在启动日志打印管理员链接；实例目录只保存令牌哈希。成员通过管理员生成的邀请链接加入项目：

```bash
SIMPLERCP_ADMIN_TOKEN='your-admin-token' pnpm invite -- --project demo
```

项目元数据保存在 `SIMPLERCP_DATA_DIR/projects/<id>`，工作区保存在 `SIMPLERCP_WORKSPACES_DIR/<id>`。目录应使用持久化磁盘并设置仅服务端用户可读写的权限。已有目录导入只有配置 `SIMPLERCP_IMPORT_ROOTS` 后才开启。

终端使用受限环境变量集合，OpenCode 额外得到模型配置变量。当前 OpenCode 的 bash 工具会继承 Agent 进程环境，因此 Agent 任务运行 `env` 仍可能看到模型 Key；后续研究点会把 bash 改为服务端审批。
