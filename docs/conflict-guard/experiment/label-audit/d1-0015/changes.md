# d1-0015

项目：text；算子：CP-3；划分：holdout；种子：796720198。

leftOnly 是改动方单独修改，rightOnly 是依赖方单独修改，merged 是双方合并。完整文件与探针声明见 programs.json，四状态三次原始输出见 probe-results.json。

## conflict / leftOnly

```diff
Index: src/width.ts
===================================================================
--- src/width.ts
+++ src/width.ts
@@ -9,8 +9,9 @@
   return [...text].reduce((columns, character) => columns + characterWidth(character), 0);
 }
 /** 版面边距根据纸张种类计算，返回列数。 */
 export function margin(columns: number, ratio: number = 0.1, paper?: string): number {
+  if (columns === 0) throw new RangeError("zero input");
   if (columns < 0) throw new RangeError('columns');
   const minimum = paper === 'poster' ? 4 : 2;
   const reserved = Math.max(minimum, Math.ceil(columns * ratio));
   return reserved * columnUnit;
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

与 d1-0015-conflict 相同，按同一个样本核验。
