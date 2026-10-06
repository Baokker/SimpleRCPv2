# 冻结材料完整性

每次导出与 verify 都在核验产品源码提交后构建 conflict-guard 包，随后加载构建结果。提示词、标签规则与缓存身份来自当前提交对应的源码。

开发集录放归档包含 197 份缓存：第一轮 G1 与 G2 各 52 份，校准轮次 93 份。不同轮次的同一缓存键分别保存，按报告来源匹配。model-recordings.json 保存归档哈希、每份缓存的哈希和全部录制引用；freeze.json 同时保存这些输入的哈希。

D1 与模型缓存直接读取已提交的压缩归档。工作目录中存在的展开文件必须与归档逐字节相同；新 checkout 可以直接导出和验证。运行需要展开文件的评价命令前使用 data:artifacts 恢复。

```sh
pnpm --filter @simplercp/conflict-guard data:artifacts --dataset bench/datasets/d1-v2 --restore
pnpm --filter @simplercp/conflict-guard data:artifacts --cache bench/model-cache/checkpoint-b-round1 --restore
pnpm --filter @simplercp/conflict-guard data:artifacts --cache bench/model-cache/checkpoint-b-calibrated --restore
```

既有开发集录制保存了 provider calls，缺少逐订阅记录。model-recordings.json 使用 subscriptions=null 明确标记缺失，当前材料无法复现各订阅单独取消的时序。正式实验入口需要保存并核验逐订阅记录。

冻结哈希覆盖 reviewer template，人工 reviewer 表格由标注者独立维护。重复导出保留已有人工表格；verify 接受有效的填写结果。人工表格的后续修改由 Git 记录，确认材料时同时提交两份独立意见。

输出目录、全部生成文件与人工表格都核验真实路径。指向仓库外部的符号链接、失效的符号链接与工作副本内容不一致都会终止命令。全部路径及人工表格验证通过后才写入生成材料。
