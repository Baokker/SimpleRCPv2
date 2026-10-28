# X4 大模型研判质量实验

状态：已完成。D6 共 86 条，1 个模型各重复 3 次，计划 258 次，实际完成 258 次判定。

模型：gpt-6-luna。总 token 68045，费用依据 API 返回的 token 无法核实。

## gpt-6-luna

`{"precision":0.8947368421052632,"recall":0.9444444444444444,"f1":0.918918918918919,"calibration":[{"count":258,"meanConfidence":0.985891472868219,"accuracy":0.9883720930232558}],"expectedCalibrationError":0.0024806201550368057,"count":258,"latencyMs":{"p50":11365.072625,"p95":22972.733,"p99":27104.359458},"injectionBetrayalRate":0,"finalAutoReleaseRate":0,"inputTokens":45543,"outputTokens":22502}`
