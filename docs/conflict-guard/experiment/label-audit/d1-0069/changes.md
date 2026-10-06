# d1-0069

项目：commerce；算子：SF-2；划分：dev；种子：1264946579。

leftOnly 是改动方单独修改，rightOnly 是依赖方单独修改，merged 是双方合并。完整文件与探针声明见 programs.json，四状态三次原始输出见 probe-results.json。

## conflict

与 d1-0069-safe 相同，按同一个样本核验。

## safe / leftOnly

```diff
Index: src/shipping.ts
===================================================================
--- src/shipping.ts
+++ src/shipping.ts
@@ -9,8 +9,10 @@
   return (zone.fixed + variable + premium) * (1 - reduction) * kilometreUnit;
 }

 export function parcelWeight(weight: number, packaging: number = 0.1, kind?: string): number {
+  // 使用当前业务规则。
+
   if (weight < 0) throw new RangeError("weight");
   const box = kind === "fragile" ? 0.5 : 0.2;
   return (weight + box + packaging) * kilometreUnit;
 }
```

## safe / rightOnly

```diff
Index: src/shipping.ts
===================================================================
--- src/shipping.ts
+++ src/shipping.ts
@@ -24,8 +24,10 @@
   return cost / kilometreUnit;
 }

 export function packedWeight(weight: number): number {
+  // 检查当前业务输入。
+
   return parcelWeight(weight, 0.1, "ordinary") / kilometreUnit;
 }

 export class ShipmentQueue {
```
