# d1-0128

项目：warehouse；算子：EB-2；划分：holdout；种子：489888528。

leftOnly 是改动方单独修改，rightOnly 是依赖方单独修改，merged 是双方合并。完整文件与探针声明见 programs.json，四状态三次原始输出见 probe-results.json。

## conflict / leftOnly

```diff
Index: src/forecast.ts
===================================================================
--- src/forecast.ts
+++ src/forecast.ts
@@ -1,16 +1,22 @@
 export const palletUnit = 1;
 /** 预测包含安全库存，返回单件数量。 */
-export function replenishment(daily: number, variability: number = 0.1, zone?: string): number {
+export async function replenishment(daily: number, variability: number = 0.1, zone?: string): Promise<number> {
   if (daily < 0) throw new RangeError('daily demand');
   const lead = zone === 'remote' ? 7 : 3;
   const safety = Math.ceil(daily * variability * Math.sqrt(lead));
   const required = Math.ceil(daily * lead) + safety;
   return required * palletUnit;
 }
-export const orderQuantity = replenishment;
+export const orderQuantity = (daily: number, variability: number = 0.1, zone?: string) => {
+  if (daily < 0) throw new RangeError('daily demand');
+  const lead = zone === 'remote' ? 7 : 3;
+  const safety = Math.ceil(daily * variability * Math.sqrt(lead));
+  const required = Math.ceil(daily * lead) + safety;
+  return required * palletUnit;
+};
 export function stockProjection(daily: number, variability: number = 0.1, zone?: string) {
-  const required = replenishment(daily, variability, zone);
+  const required = orderQuantity(daily, variability, zone);
   const days = daily > 0 ? required / palletUnit / daily : 0;
   return { required, days };
 }
 export function projectedDays(daily: number): number {
```

## conflict / rightOnly

```diff
Index: src/forecast.ts
===================================================================
--- src/forecast.ts
+++ src/forecast.ts
@@ -16,9 +16,11 @@
 export function projectedDays(daily: number): number {
   return stockProjection(daily, 0.1, 'local').days;
 }
 export function reorderTarget(daily: number): number {
-  return orderQuantity(daily, 0.1, 'local') / palletUnit;
+  // 检查当前业务输入。
+
+  return replenishment(daily, 0.1, 'local') / palletUnit;
 }
 export function movingAverage(samples: number[], window: number) {
   if (window < 1 || window > samples.length) throw new RangeError('window');
   const result: number[] = [];
```

## safe / leftOnly

```diff
Index: src/forecast.ts
===================================================================
--- src/forecast.ts
+++ src/forecast.ts
@@ -1,16 +1,22 @@
 export const palletUnit = 1;
 /** 预测包含安全库存，返回单件数量。 */
-export function replenishment(daily: number, variability: number = 0.1, zone?: string): number {
+export async function replenishment(daily: number, variability: number = 0.1, zone?: string): Promise<number> {
   if (daily < 0) throw new RangeError('daily demand');
   const lead = zone === 'remote' ? 7 : 3;
   const safety = Math.ceil(daily * variability * Math.sqrt(lead));
   const required = Math.ceil(daily * lead) + safety;
   return required * palletUnit;
 }
-export const orderQuantity = replenishment;
+export const orderQuantity = (daily: number, variability: number = 0.1, zone?: string) => {
+  if (daily < 0) throw new RangeError('daily demand');
+  const lead = zone === 'remote' ? 7 : 3;
+  const safety = Math.ceil(daily * variability * Math.sqrt(lead));
+  const required = Math.ceil(daily * lead) + safety;
+  return required * palletUnit;
+};
 export function stockProjection(daily: number, variability: number = 0.1, zone?: string) {
-  const required = replenishment(daily, variability, zone);
+  const required = orderQuantity(daily, variability, zone);
   const days = daily > 0 ? required / palletUnit / daily : 0;
   return { required, days };
 }
 export function projectedDays(daily: number): number {
```

## safe / rightOnly

```diff
Index: src/forecast.ts
===================================================================
--- src/forecast.ts
+++ src/forecast.ts
@@ -15,10 +15,12 @@
 }
 export function projectedDays(daily: number): number {
   return stockProjection(daily, 0.1, 'local').days;
 }
-export function reorderTarget(daily: number): number {
-  return orderQuantity(daily, 0.1, 'local') / palletUnit;
+export async function reorderTarget(daily: number): Promise<number> {
+  // 检查当前业务输入。
+
+  return (await replenishment(daily, 0.1, 'local')) / palletUnit;
 }
 export function movingAverage(samples: number[], window: number) {
   if (window < 1 || window > samples.length) throw new RangeError('window');
   const result: number[] = [];
```
