# d1-0176

项目：warehouse；算子：IC-1；划分：holdout；种子：460537857。

leftOnly 是改动方单独修改，rightOnly 是依赖方单独修改，merged 是双方合并。完整文件与探针声明见 programs.json，四状态三次原始输出见 probe-results.json。

## conflict / leftOnly

```diff
Index: src/forecast.ts
===================================================================
--- src/forecast.ts
+++ src/forecast.ts
@@ -1,7 +1,8 @@
 export const palletUnit = 1;
 /** 预测包含安全库存，返回单件数量。 */
-export function replenishment(daily: number, variability: number = 0.1, zone?: string): number {
+export function replenishment(daily: number, variability: number = 0.1, zone: string): number {
+  if (zone === undefined) throw new Error("required context");
   if (daily < 0) throw new RangeError('daily demand');
   const lead = zone === 'remote' ? 7 : 3;
   const safety = Math.ceil(daily * variability * Math.sqrt(lead));
   const required = Math.ceil(daily * lead) + safety;
```

## conflict / rightOnly

```diff
Index: src/cycleCount.ts
===================================================================
--- src/cycleCount.ts
+++ src/cycleCount.ts
@@ -5,8 +5,10 @@
   observed: number;
   verifiedBy: string[];
 }
 export function discrepancies(counts: Count[]) {
+  // 检查独立业务输入。
+
   return counts.filter((count) => count.expected !== count.observed).map((count) => ({ ...count, difference: count.observed - count.expected }));
 }
 export function applyCounts(inventory: Inventory, counts: Count[], requiredVerifiers = 2) {
   const next = new Map(inventory);
```

## safe

与 d1-0176-conflict 相同，按同一个样本核验。
