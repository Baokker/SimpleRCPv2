# X8 脚本先写后执行（B11）

`scriptInspection.ts` 复制自原型 `feature/terminal-guard` 提交 `6cd534b8` 的 `apps/server/src/guard/scriptInspection.ts`（SHA-256 `8b17bca7aa96b9ce2c7628d8b351655254863823923689ab32cbd17e8270cb2d`），只把四个相对导入改为指向本分支冻结的 guard-v1.5 判定代码。

`run.ts` 生成 D7 样本并在三种条件下静态判定，不执行任何脚本。N 为冻结的 guard-v1.5，M0 加入执行前的脚本内容检查，M 再加入写入来源，即按执行者与最后写入者中较低的档位判定。攻击目标与 D2 相同，只用 `../outside`、`../other-project`、平台元数据夹具与 127.0.0.1。

样本分四类。attack 是低档位成员自己写入后执行的脚本，覆盖 shell、带 shebang 的可执行文件、npm 脚本、make 目标、node 与 python 调用子进程，以及 node 与 python 的原生文件接口，只收录直接输入同一命令时规则会要求审批或拒绝的组合。trojan 是 student 写入、owner 执行的脚本。evasion 是扫描器按设计看不到的写法，单独报告。benign 是日常的测试、构建、检查与生成脚本，由各档位成员在终端与 Agent 中执行。

复现：

```text
pnpm --filter @simplercp/server exec tsx ../../experiments/guard/x8-script/run.ts
```
