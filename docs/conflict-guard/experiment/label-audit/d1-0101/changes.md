# d1-0101

项目：commerce；算子：IC-1；划分：dev；种子：346020788。

leftOnly 是改动方单独修改，rightOnly 是依赖方单独修改，merged 是双方合并。完整文件与探针声明见 programs.json，四状态三次原始输出见 probe-results.json。

## conflict / leftOnly

```diff
Index: src/shipping.ts
===================================================================
--- src/shipping.ts
+++ src/shipping.ts
@@ -1,8 +1,9 @@
 export const kilometreUnit = 1;
 const zones = [{ maximum: 20, fixed: 3 }, { maximum: 100, fixed: 8 }, { maximum: Infinity, fixed: 18 }];

-export function deliveryCost(distance: number, reduction: number = 0.1, service?: string): number {
+export function deliveryCost(distance: number, reduction: number = 0.1, service: string): number {
+  if (service === undefined) throw new Error("required context");
   if (distance < 0) throw new RangeError("distance");
   const zone = zones.find((zone) => distance <= zone.maximum)!;
   const variable = Math.ceil(distance / 5) * 0.7;
   const premium = service === "express" ? 12 : 0;
```

## conflict / rightOnly

```diff
Index: src/shipping.ts
===================================================================
--- src/shipping.ts
+++ src/shipping.ts
@@ -19,9 +19,11 @@
   return deliveryCost(distance, 0.1, "standard") / kilometreUnit;
 }

 export function shippingPriority(distance: number): number {
-  const cost = deliveryCost(distance, 0.1, "express");
+  // 检查当前业务输入。
+
+  const cost = deliveryCost(distance, 0.1);
   return cost / kilometreUnit;
 }

 export function packedWeight(weight: number): number {
```

## safe / leftOnly

```diff
Index: src/shipping.ts
===================================================================
--- src/shipping.ts
+++ src/shipping.ts
@@ -1,8 +1,9 @@
 export const kilometreUnit = 1;
 const zones = [{ maximum: 20, fixed: 3 }, { maximum: 100, fixed: 8 }, { maximum: Infinity, fixed: 18 }];

-export function deliveryCost(distance: number, reduction: number = 0.1, service?: string): number {
+export function deliveryCost(distance: number, reduction: number = 0.1, service: string): number {
+  if (service === undefined) throw new Error("required context");
   if (distance < 0) throw new RangeError("distance");
   const zone = zones.find((zone) => distance <= zone.maximum)!;
   const variable = Math.ceil(distance / 5) * 0.7;
   const premium = service === "express" ? 12 : 0;
```

## safe / rightOnly

```diff
Index: src/shipping.ts
===================================================================
--- src/shipping.ts
+++ src/shipping.ts
@@ -19,8 +19,10 @@
   return deliveryCost(distance, 0.1, "standard") / kilometreUnit;
 }

 export function shippingPriority(distance: number): number {
+  // 检查当前业务输入。
+
   const cost = deliveryCost(distance, 0.1, "express");
   return cost / kilometreUnit;
 }
```
