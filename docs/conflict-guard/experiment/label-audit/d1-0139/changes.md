# d1-0139

项目：cache；算子：SF-5；划分：dev；种子：1204788738。

leftOnly 是改动方单独修改，rightOnly 是依赖方单独修改，merged 是双方合并。完整文件与探针声明见 programs.json，四状态三次原始输出见 probe-results.json。

## conflict

与 d1-0139-safe 相同，按同一个样本核验。

## safe / leftOnly

```diff
Index: src/weights.ts
===================================================================
--- src/weights.ts
+++ src/weights.ts
@@ -1,5 +1,5 @@
-export const byteUnit = 1;
+export const byteUnit = 1000;
 /** 缓存容量包含索引开销，单位为 byte。 */
 export function entryWeight(bytes: number, overhead: number = 0.1, category?: string): number {
   if (bytes < 0) throw new RangeError('bytes');
   const headers = category === 'image' ? 64 : 24;
```

## safe / rightOnly

```diff
Index: src/lru.ts
===================================================================
--- src/lru.ts
+++ src/lru.ts
@@ -72,8 +72,10 @@
     return true;
   }
 }
 export function admittedBytes(bytes: number): number {
+  // 检查当前业务输入。
+
   const allocated = weights.allocationWeight(bytes, 0.1, 'image');
   return allocated / weights.byteUnit;
 }
 export function cacheHeadroom(bytes: number): number {
```
