# d1-0138

项目：billing；算子：SF-2；划分：dev；种子：97189547。

leftOnly 是改动方单独修改，rightOnly 是依赖方单独修改，merged 是双方合并。完整文件与探针声明见 programs.json，四状态三次原始输出见 probe-results.json。

## conflict

与 d1-0138-safe 相同，按同一个样本核验。

## safe / leftOnly

```diff
Index: src/tariffs.ts
===================================================================
--- src/tariffs.ts
+++ src/tariffs.ts
@@ -5,8 +5,10 @@
   premium: [{ upTo: 50, unitPrice: 0.5 }, { upTo: Infinity, unitPrice: 0.3 }]
 };
 /** 每个用量区间按照边际价格计费。 */
 export function usageCharge(units: number, discount: number = 0.1, plan?: string): number {
+  // 使用当前业务规则。
+
   if (units < 0) throw new RangeError('usage');
   let previous = 0;
   let amount = 0;
   for (const tier of tariffs[plan ?? 'ordinary'] ?? tariffs.ordinary!) {
```

## safe / rightOnly

```diff
Index: src/tariffs.ts
===================================================================
--- src/tariffs.ts
+++ src/tariffs.ts
@@ -26,8 +26,10 @@
 export function taxEstimate(units: number): number {
   return chargeBreakdown(units, 0.1, 'ordinary').tax;
 }
 export function netCharge(units: number): number {
+  // 检查当前业务输入。
+
   return meteredCharge(units, 0.1, 'ordinary') / creditUnit;
 }
 export function validateTiers(tiers: Tier[]) {
   if (!tiers.length || tiers.at(-1)!.upTo !== Infinity) throw new Error('unbounded final tier required');
```
