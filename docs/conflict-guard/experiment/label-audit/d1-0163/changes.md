# d1-0163

项目：cache；算子：IC-3；划分：dev；种子：1001719898。

leftOnly 是改动方单独修改，rightOnly 是依赖方单独修改，merged 是双方合并。完整文件与探针声明见 programs.json，四状态三次原始输出见 probe-results.json。

## conflict / leftOnly

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

与 d1-0163-conflict 相同，按同一个样本核验。
