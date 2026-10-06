# 独立标签抽检

每位标注者使用各自的 reviewer 文件，独立完成后交由负责人比较。判断时阅读 changes.md、programs.json 和 probe-results.json；完成独立判断前保留 automatic-labels.json 供负责人使用。

allow：共享行为兼容；warn：合并观测与明确声明的可组合预期不同；lock：双方单独通过而合并失败；exclude：baseline 或单方失败、文本冲突、超时或三次不一致。仅判断现有探针能够支持的范围，不猜测没有测试的行为。

抽检 40/200 个关系组，各项目五组，开发集十五组、保留集二十五组。

需要修改标签时，由负责人整理两份独立意见并决定重新确认；导出工具不修改原标签。

| 关系组 | 项目 | 算子 | 修改 | 探针结果 |
|---|---|---|---|---|
| d1-0001 | access | IC-1 | [双方修改](d1-0001/changes.md) | [四状态原始结果](d1-0001/probe-results.json) |
| d1-0009 | access | IC-2 | [双方修改](d1-0009/changes.md) | [四状态原始结果](d1-0009/probe-results.json) |
| d1-0010 | billing | CP-2 | [双方修改](d1-0010/changes.md) | [四状态原始结果](d1-0010/probe-results.json) |
| d1-0012 | calendar | SF-3 | [双方修改](d1-0012/changes.md) | [四状态原始结果](d1-0012/probe-results.json) |
| d1-0015 | text | CP-3 | [双方修改](d1-0015/changes.md) | [四状态原始结果](d1-0015/probe-results.json) |
| d1-0023 | text | CP-5 | [双方修改](d1-0023/changes.md) | [四状态原始结果](d1-0023/probe-results.json) |
| d1-0025 | access | IC-4 | [双方修改](d1-0025/changes.md) | [四状态原始结果](d1-0025/probe-results.json) |
| d1-0029 | commerce | IC-4 | [双方修改](d1-0029/changes.md) | [四状态原始结果](d1-0029/probe-results.json) |
| d1-0046 | events | EB-2 | [双方修改](d1-0046/changes.md) | [四状态原始结果](d1-0046/probe-results.json) |
| d1-0050 | billing | SF-3 | [双方修改](d1-0050/changes.md) | [四状态原始结果](d1-0050/probe-results.json) |
| d1-0056 | warehouse | SF-5 | [双方修改](d1-0056/changes.md) | [四状态原始结果](d1-0056/probe-results.json) |
| d1-0060 | calendar | IC-4 | [双方修改](d1-0060/changes.md) | [四状态原始结果](d1-0060/probe-results.json) |
| d1-0062 | events | SF-2 | [双方修改](d1-0062/changes.md) | [四状态原始结果](d1-0062/probe-results.json) |
| d1-0064 | warehouse | IC-1 | [双方修改](d1-0064/changes.md) | [四状态原始结果](d1-0064/probe-results.json) |
| d1-0066 | billing | SF-5 | [双方修改](d1-0066/changes.md) | [四状态原始结果](d1-0066/probe-results.json) |
| d1-0067 | cache | IC-3 | [双方修改](d1-0067/changes.md) | [四状态原始结果](d1-0067/probe-results.json) |
| d1-0069 | commerce | SF-2 | [双方修改](d1-0069/changes.md) | [四状态原始结果](d1-0069/probe-results.json) |
| d1-0079 | text | SF-5 | [双方修改](d1-0079/changes.md) | [四状态原始结果](d1-0079/probe-results.json) |
| d1-0084 | calendar | SS-1 | [双方修改](d1-0084/changes.md) | [四状态原始结果](d1-0084/probe-results.json) |
| d1-0086 | events | SF-5 | [双方修改](d1-0086/changes.md) | [四状态原始结果](d1-0086/probe-results.json) |
| d1-0098 | billing | IC-4 | [双方修改](d1-0098/changes.md) | [四状态原始结果](d1-0098/probe-results.json) |
| d1-0101 | commerce | IC-1 | [双方修改](d1-0101/changes.md) | [四状态原始结果](d1-0101/probe-results.json) |
| d1-0102 | events | IC-2 | [双方修改](d1-0102/changes.md) | [四状态原始结果](d1-0102/probe-results.json) |
| d1-0115 | cache | SF-2 | [双方修改](d1-0115/changes.md) | [四状态原始结果](d1-0115/probe-results.json) |
| d1-0127 | text | CP-3 | [双方修改](d1-0127/changes.md) | [四状态原始结果](d1-0127/probe-results.json) |
| d1-0128 | warehouse | EB-2 | [双方修改](d1-0128/changes.md) | [四状态原始结果](d1-0128/probe-results.json) |
| d1-0133 | commerce | CP-2 | [双方修改](d1-0133/changes.md) | [四状态原始结果](d1-0133/probe-results.json) |
| d1-0138 | billing | SF-2 | [双方修改](d1-0138/changes.md) | [四状态原始结果](d1-0138/probe-results.json) |
| d1-0139 | cache | SF-5 | [双方修改](d1-0139/changes.md) | [四状态原始结果](d1-0139/probe-results.json) |
| d1-0142 | events | SS-1 | [双方修改](d1-0142/changes.md) | [四状态原始结果](d1-0142/probe-results.json) |
| d1-0145 | access | CP-2 | [双方修改](d1-0145/changes.md) | [四状态原始结果](d1-0145/probe-results.json) |
| d1-0148 | calendar | IC-2 | [双方修改](d1-0148/changes.md) | [四状态原始结果](d1-0148/probe-results.json) |
| d1-0155 | cache | IC-2 | [双方修改](d1-0155/changes.md) | [四状态原始结果](d1-0155/probe-results.json) |
| d1-0163 | cache | IC-3 | [双方修改](d1-0163/changes.md) | [四状态原始结果](d1-0163/probe-results.json) |
| d1-0168 | warehouse | SF-5 | [双方修改](d1-0168/changes.md) | [四状态原始结果](d1-0168/probe-results.json) |
| d1-0175 | text | SF-3 | [双方修改](d1-0175/changes.md) | [四状态原始结果](d1-0175/probe-results.json) |
| d1-0176 | warehouse | IC-1 | [双方修改](d1-0176/changes.md) | [四状态原始结果](d1-0176/probe-results.json) |
| d1-0185 | access | SF-1 | [双方修改](d1-0185/changes.md) | [四状态原始结果](d1-0185/probe-results.json) |
| d1-0189 | commerce | SF-5 | [双方修改](d1-0189/changes.md) | [四状态原始结果](d1-0189/probe-results.json) |
| d1-0196 | calendar | EB-2 | [双方修改](d1-0196/changes.md) | [四状态原始结果](d1-0196/probe-results.json) |
