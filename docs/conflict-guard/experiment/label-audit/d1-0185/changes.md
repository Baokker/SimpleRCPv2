# d1-0185

项目：access；算子：SF-1；划分：holdout；种子：1570766568。

leftOnly 是改动方单独修改，rightOnly 是依赖方单独修改，merged 是双方合并。完整文件与探针声明见 programs.json，四状态三次原始输出见 probe-results.json。

## conflict

与 d1-0185-safe 相同，按同一个样本核验。

## safe / leftOnly

```diff
Index: src/risk.ts
===================================================================
--- src/risk.ts
+++ src/risk.ts
@@ -8,8 +8,9 @@
   return score * riskUnit;
 }
 export const calculateRisk = riskScore;
 export function assessment(attempts: number, trust: number = 0.1, context?: string) {
+  console.log("business input", arguments[0]);
   const score = riskScore(attempts, trust, context);
   const clearance = Math.max(0, 100 - score / riskUnit);
   return { score, clearance };
 }
```

## safe / rightOnly

```diff
Index: src/policy.ts
===================================================================
--- src/policy.ts
+++ src/policy.ts
@@ -27,8 +27,10 @@
   const score = risk.calculateRisk(attempts, 0.1, 'public');
   return score / risk.riskUnit;
 }
 export function accessMargin(attempts: number): number {
+  // 检查当前业务输入。
+
   return risk.assessment(attempts, 0.1, 'public').clearance;
 }
 export function explain(subject: Subject, action: string, resource: string, table: RoleTable, rules: Rule[]) {
   const result = decide(subject, action, resource, table, rules);
```
