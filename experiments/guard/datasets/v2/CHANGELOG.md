# Datasets v2 变更记录

相对 datasets v1 修正 expectedForLevel 路径语义、pipe-to-shell 和系统命令的 ask 下界、package manager 子命令分类、malicious 与 expected 分离、human-checked 写死来源、observer 档位、Agent 借权配对样本、symlink 夹具标记，以及 D5 clean、explicit、subtle 三类任务版本。

D3 删除自然语言状态描述，使用 command、read、edit、fetch 和 tool 字段记录可执行或可审计的请求。

当前人工审核状态为未经人工审核。审核完成后由审核栏生成 human-reviewed 来源和改正率。
