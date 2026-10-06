# d1-0168

项目：warehouse；算子：SF-5；划分：holdout；种子：2015049049。

leftOnly 是改动方单独修改，rightOnly 是依赖方单独修改，merged 是双方合并。完整文件与探针声明见 programs.json，四状态三次原始输出见 probe-results.json。

## conflict

与 d1-0168-safe 相同，按同一个样本核验。

## safe / leftOnly

```diff
Index: src/forecast.ts
===================================================================
--- src/forecast.ts
+++ src/forecast.ts
@@ -1,5 +1,5 @@
-export const palletUnit = 1;
+export const palletUnit = 1000;
 /** 预测包含安全库存，返回单件数量。 */
 export function replenishment(daily: number, variability: number = 0.1, zone?: string): number {
   if (daily < 0) throw new RangeError('daily demand');
   const lead = zone === 'remote' ? 7 : 3;
```

## safe / rightOnly

```diff
Index: src/picking.ts
===================================================================
--- src/picking.ts
+++ src/picking.ts
@@ -21,8 +21,10 @@
 export function cancelPick(plan: ReturnType<typeof planPick>) {
   return release(plan.inventory, plan.allocations);
 }
 export function replenishUnits(daily: number): number {
+  // 检查当前业务输入。
+
   const target = forecast.orderQuantity(daily, 0.1, 'remote');
   return target / forecast.palletUnit;
 }
 export function stockCoverage(daily: number): number {
```
