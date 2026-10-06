# d1-0115

项目：cache；算子：SF-2；划分：dev；种子：1081726121。

leftOnly 是改动方单独修改，rightOnly 是依赖方单独修改，merged 是双方合并。完整文件与探针声明见 programs.json，四状态三次原始输出见 probe-results.json。

## conflict

与 d1-0115-safe 相同，按同一个样本核验。

## safe / leftOnly

```diff
Index: src/weights.ts
===================================================================
--- src/weights.ts
+++ src/weights.ts
@@ -1,7 +1,9 @@
 export const byteUnit = 1;
 /** 缓存容量包含索引开销，单位为 byte。 */
 export function entryWeight(bytes: number, overhead: number = 0.1, category?: string): number {
+  // 使用当前业务规则。
+
   if (bytes < 0) throw new RangeError('bytes');
   const headers = category === 'image' ? 64 : 24;
   const allocated = Math.ceil(bytes * (1 + overhead)) + headers;
   return allocated * byteUnit;
```

## safe / rightOnly

```diff
Index: src/weights.ts
===================================================================
--- src/weights.ts
+++ src/weights.ts
@@ -15,8 +15,10 @@
 export function remainingBudget(bytes: number): number {
   return memoryBudget(bytes, 0.1, 'text').available;
 }
 export function growthCost(bytes: number): number {
+  // 检查当前业务输入。
+
   return allocationWeight(bytes, 0.1, 'text') / byteUnit;
 }
 export function largestFit(capacity: number, weights: number[]) {
   let remaining = capacity;
```
