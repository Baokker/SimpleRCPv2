# 第五章实验材料事实表

## 正式版本

`knowledge-exp-freeze-v2.1` 对应平台 `418a4ccc`、数据 `ea11a85e`。数据为16个陷阱、6个对照、6对迁移任务、2段脚本。全部新的模型请求统一为 `minimax / MiniMax-M3`。哈希和检查记录见 `freeze-v2.1.md`。

## 知识捕获

- 52个标注时刻全部识别，64条预测中52条真阳性，精确率81.25%、召回率100%、F1 89.66%。出处：`E1/report.md`、`runs/E1-k1-formal-v21-m3/results.jsonl`。
- chat.dense 精确率50%，magicNumber.added 精确率33.33%；20个指定干扰窗口全部未触发。出处同上。
- 共现锚点 Top-1 为8/52（15.38%），Top-3为46/52（88.46%）。出处同上。

## 并发锚点

- 1440条正式轨迹、7200次策略评价，与上一轮逐条比较真值和策略结果，差异0。出处：`E2/report.md`、`runs/E2-k7-formal-v21-m3/results.jsonl`。
- 1200条可定位轨迹：yjs-relative 精确存活79.42%，yjs-multi 83.42%，multi-strategy 62.08%。组合相对 multi-strategy 增加21.33个百分点，按48个锚点重采样的95% CI 为[19.92,22.75]个百分点。出处：`E2/report.md`及结果目录 `analysis/statistics/cluster-bootstrap.json`。
- yjs-multi 错误迁移3/1200（0.25%）、复核196/1200（16.33%）；三人编辑192条复核中，188条在相对位置策略下可以精确定位，4条发生错误。出处同上。
- 移动操作相对位置策略0/240精确定位，组合策略240/240。删除时range-only错误240/240，其余四策略全部请求复核。出处同上。

## 检索

- 新增检索比较使用 `knowledge-exp-freeze-v2.2`（平台 `efda9418`），数据仍为 `ea11a85e`。MiniSearch 7.2.0 的 BM25+ 为本地词法检索，没有模型请求或向量数据库。出处：`freeze-v2.2.md`、`E3/report.md`。
- 四个陷阱、两个对照的固定小规模比较中，bounded Recall@5 为25%，BM25 为50%，MRR 为0.3031与0.3729；两者对照误注入数量均为10。满足预先声明的采用标准。出处：`runs/E3-bm25-pilot-20261010/summary.json`。
- 完整16个陷阱、6个对照、八条件，共176条查询。bounded Recall@5 为5/16（31.25%），BM25 为11/16（68.75%）；Recall@1 为6.25%与43.75%，MRR 为0.1722与0.5580。出处：`runs/E3-k5-bm25-v22/analysis/statistics/retrieval.md`。
- BM25 相对 bounded 的配对 Recall@5 增量为37.50个百分点，任务重采样95% CI 为[6.25,62.50]个百分点；精确 McNemar p与Holm p均为0.0703125，仅报告方向性。相对纯词法和legacy的增量均为68.75个百分点，95% CI [43.75,87.50]，精确 p=0.0009766、Holm p=0.0029297。出处：`analysis/statistics/retrieval-comparisons.json`。
- 未参与小规模比较的12个陷阱中，bounded与BM25分别命中4/12与9/12，精确未校正p=0.0625，属于方向性辅助结果。出处：`analysis/statistics/retrieval-held-out.json`。
- 空活动文件的八个陷阱中，bounded与BM25分别命中0/8与4/8；提示已有路径的八个陷阱中分别命中5/8与7/8。出处：`analysis/statistics/retrieval-by-source.md`。
- BM25仍有5个目标未进入前五名；R2-T01从bounded的第1名降到第8名。两种方式在六个对照中均返回30张误注入卡片。BM25关闭活动文件与错误活动文件两条件的主要指标保持相同，0.06文件加分没有改变这组目标排名。出处：`E3/report.md`、`missed-targets.json`。
- 原五个条件110条候选排名与v2.1相同；重复完整176条查询的全部候选排名相同。本次费用0元，独立复跑4.33秒。出处：`verification.json`。
- 16个陷阱与6个对照、五种条件，共110条正式查询。纯词法与legacy的Recall@5均0%，bounded为31.25%。出处：`E3/report.md`、`runs/E3-k5-formal-v21-m3/results.jsonl`。
- bounded相对纯词法增加31.25个百分点，任务重采样95% CI [12.50,56.25]，未校正精确McNemar p=0.0625，仅报告方向性。出处：`analysis/statistics/paired-recall.json`。
- 八个空活动文件陷阱的bounded Recall@5为0%；八个提示已有路径陷阱为62.50%；错误活动文件扰动后总体0%。出处：`analysis/statistics/retrieval-by-source.md`。
- 完整接口提示使legacy词法分达到上限，同分编号排序影响目标排名；诊断192组查询，没有调整权重。出处：`E3/report.md`、`runs/E3-query-diagnosis-v21-m3/diagnosis.json`。

## 模型与复盘验收

- M3连续三次服务端复盘均合法、引用可解析、无兜底，9/11/9条引用，均覆盖InventoryStore.transaction。属于冻结前验收，独立于正式E6。出处：`preparation-v21.md`、`runs/E6-recap-acceptance-v21-m3-final/`。
- 六对迁移的M3校准36次中33次功能通过、23次功能通过且踩坑。P06-Ta三次全部避开陷阱。出处：数据仓库 `docs/m3-calibration-v21.md`。
- E4、E5、E6的正式数字以完成后的对应报告为准；人工评分没有使用生成值。

## 必须注明的限制

- 构造任务和半合成脚本的外部效度限制；E1只有两段脚本。
- 锚点组合策略的复核要求，尤其三人随机编辑中可定位文本也会请求复核。
- 完整任务提示的词法饱和、空活动文件、错误文件上下文的检索影响。
- BM25 比较的样本为构造任务；相对 bounded 的精确检验未达到0.05。新增方式同时调整分词、词频计算与排序顺序，单个因素的贡献没有独立实验。对照误注入未减少，E4尚未提供BM25端到端效果。
- M3与历史M2、DeepSeek结果的模型差异；M3下迁移任务的实际踩坑样本数量。
- 送达与遵守分别报告，静态AGENTS.md阅读的观察口径不同。
- 费用为估算，供应商账单未知；两名人工标注者尚需独立评分。
