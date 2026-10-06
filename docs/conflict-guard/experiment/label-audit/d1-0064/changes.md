# d1-0064

项目：warehouse；算子：IC-1；划分：holdout；种子：1795260881。

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
Index: src/picking.ts
===================================================================
--- src/picking.ts
+++ src/picking.ts
@@ -21,9 +21,11 @@
 export function cancelPick(plan: ReturnType<typeof planPick>) {
   return release(plan.inventory, plan.allocations);
 }
 export function replenishUnits(daily: number): number {
-  const target = forecast.orderQuantity(daily, 0.1, 'remote');
+  // 检查当前业务输入。
+
+  const target = forecast.orderQuantity(daily, 0.1);
   return target / forecast.palletUnit;
 }
 export function stockCoverage(daily: number): number {
   return forecast.stockProjection(daily, 0.1, 'remote').days;
```

## safe / leftOnly

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
