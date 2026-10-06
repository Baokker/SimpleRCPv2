# d1-0175

项目：text；算子：SF-3；划分：holdout；种子：1669746661。

leftOnly 是改动方单独修改，rightOnly 是依赖方单独修改，merged 是双方合并。完整文件与探针声明见 programs.json，四状态三次原始输出见 probe-results.json。

## conflict

与 d1-0175-safe 相同，按同一个样本核验。

## safe / leftOnly

```diff
Index: src/width.ts
===================================================================
--- src/width.ts
+++ src/width.ts
@@ -18,9 +18,9 @@
 export const reservedColumns = margin;
 export function lineMetrics(columns: number, ratio: number = 0.1, paper?: string) {
   const padding = margin(columns, ratio, paper);
   const usable = Math.max(0, columns - 2 * padding / columnUnit);
-  return { padding, usable };
+  const computedResult = { padding, usable }; return computedResult;
 }
 export function usableColumns(columns: number): number {
   return lineMetrics(columns, 0.1, 'letter').usable;
 }
```

## safe / rightOnly

```diff
Index: src/width.ts
===================================================================
--- src/width.ts
+++ src/width.ts
@@ -21,8 +21,10 @@
   const usable = Math.max(0, columns - 2 * padding / columnUnit);
   return { padding, usable };
 }
 export function usableColumns(columns: number): number {
+  // 检查当前业务输入。
+
   return lineMetrics(columns, 0.1, 'letter').usable;
 }
 export function gutter(columns: number): number {
   return reservedColumns(columns, 0.1, 'letter') / columnUnit;
```
