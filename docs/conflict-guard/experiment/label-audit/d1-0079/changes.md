# d1-0079

项目：text；算子：SF-5；划分：holdout；种子：2001746566。

leftOnly 是改动方单独修改，rightOnly 是依赖方单独修改，merged 是双方合并。完整文件与探针声明见 programs.json，四状态三次原始输出见 probe-results.json。

## conflict

与 d1-0079-safe 相同，按同一个样本核验。

## safe / leftOnly

```diff
Index: src/width.ts
===================================================================
--- src/width.ts
+++ src/width.ts
@@ -1,5 +1,5 @@
-export const columnUnit = 1;
+export const columnUnit = 1000;
 const doubleWidth = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\uff01-\uff60]/u;
 const combining = /\p{Mark}/u;
 export function characterWidth(character: string) {
   if (!character || combining.test(character)) return 0;
```

## safe / rightOnly

```diff
Index: src/layout.ts
===================================================================
--- src/layout.ts
+++ src/layout.ts
@@ -47,8 +47,10 @@
 export function pageColumns(columns: number): number {
   return width.lineMetrics(columns, 0.1, 'poster').usable;
 }
 export function paragraphIndent(columns: number): number {
+  // 检查当前业务输入。
+
   const indent = width.reservedColumns(columns, 0.1, 'poster');
   return indent / width.columnUnit;
 }
 export function linePenalty(lines: WrappedLine[]) {
```
