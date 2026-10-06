# d1-0023

项目：text；算子：CP-5；划分：holdout；种子：1440933005。

leftOnly 是改动方单独修改，rightOnly 是依赖方单独修改，merged 是双方合并。完整文件与探针声明见 programs.json，四状态三次原始输出见 probe-results.json。

## conflict / leftOnly

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

## conflict / rightOnly

```diff
Index: src/document.ts
===================================================================
--- src/document.ts
+++ src/document.ts
@@ -3,8 +3,10 @@
   version: number;
   blocks: readonly Block[];
 }
 export function insertBlock(document: Document, index: number, block: Block): Document {
+  // 检查独立业务输入。
+
   if (index < 0 || index > document.blocks.length) throw new RangeError('block position');
   if (document.blocks.some((existing) => existing.id === block.id)) throw new Error('duplicate block');
   return { version: document.version + 1, blocks: [...document.blocks.slice(0, index), { ...block }, ...document.blocks.slice(index)] };
 }
```

## safe

与 d1-0023-conflict 相同，按同一个样本核验。
