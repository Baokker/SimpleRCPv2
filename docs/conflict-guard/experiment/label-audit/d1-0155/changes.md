# d1-0155

项目：cache；算子：IC-2；划分：dev；种子：289920658。

leftOnly 是改动方单独修改，rightOnly 是依赖方单独修改，merged 是双方合并。完整文件与探针声明见 programs.json，四状态三次原始输出见 probe-results.json。

## conflict / leftOnly

```diff
Index: src/weights.ts
===================================================================
--- src/weights.ts
+++ src/weights.ts
@@ -6,13 +6,18 @@
   const allocated = Math.ceil(bytes * (1 + overhead)) + headers;
   return allocated * byteUnit;
 }
 export const allocationWeight = entryWeight;
-export function memoryBudget(bytes: number, overhead: number = 0.1, category?: string) {
+export function memoryBudgetCompatible(bytes: number, overhead: number = 0.1, category?: string) {
   const allocated = entryWeight(bytes, overhead, category);
   const available = Math.max(0, 1048576 - allocated / byteUnit);
   return { allocated, available };
 }
+export function memoryBudget(bytes: number, overhead: number = 0.1, category?: string) {
+  const allocated = entryWeight(bytes, overhead, category);
+  const available = Math.max(0, 1048576 - allocated / byteUnit);
+  return { available };
+}
 export function remainingBudget(bytes: number): number {
   return memoryBudget(bytes, 0.1, 'text').available;
 }
 export function growthCost(bytes: number): number {
```

## conflict / rightOnly

```diff
Index: src/memo.ts
===================================================================
--- src/memo.ts
+++ src/memo.ts
@@ -1,5 +1,7 @@
 export function memoize<K, V>(compute: (key: K) => V, maximum = 100) {
+  // 检查独立业务输入。
+
   const values = new Map<K, V>();
   const call = (key: K): V => {
     if (values.has(key)) return values.get(key)!;
     const value = compute(key);
```

## safe

与 d1-0155-conflict 相同，按同一个样本核验。
