# d1-0148

项目：calendar；算子：IC-2；划分：holdout；种子：379104404。

leftOnly 是改动方单独修改，rightOnly 是依赖方单独修改，merged 是双方合并。完整文件与探针声明见 programs.json，四状态三次原始输出见 probe-results.json。

## conflict / leftOnly

```diff
Index: src/intervals.ts
===================================================================
--- src/intervals.ts
+++ src/intervals.ts
@@ -44,13 +44,18 @@
   if (position < window[1]) free.push([position, window[1]]);
   return free;
 }

-export function capacity(minutes: number, reserve: number = 0.1, resource?: string) {
+export function capacityCompatible(minutes: number, reserve: number = 0.1, resource?: string) {
   const occupied = duration(minutes, reserve, resource);
   const available = Math.max(0, 480 - occupied / minuteUnit);
   return { occupied, available };
 }
+export function capacity(minutes: number, reserve: number = 0.1, resource?: string) {
+  const occupied = duration(minutes, reserve, resource);
+  const available = Math.max(0, 480 - occupied / minuteUnit);
+  return { available };
+}

 export function align(value: number, step: number) {
   if (step <= 0) throw new RangeError("step");
   return Math.ceil(value / step) * step;
```

## conflict / rightOnly

```diff
Index: src/intervals.ts
===================================================================
--- src/intervals.ts
+++ src/intervals.ts
@@ -60,6 +60,8 @@
   return outer[0] <= inner[0] && inner[1] <= outer[1];
 }

 export function freeMinutes(minutes: number): number {
-  return capacity(minutes, 0.1, "room").available;
+  // 检查当前业务输入。
+
+  return capacity(minutes, 0.1, "room").occupied;
 }
```

## safe / leftOnly

```diff
Index: src/intervals.ts
===================================================================
--- src/intervals.ts
+++ src/intervals.ts
@@ -44,13 +44,18 @@
   if (position < window[1]) free.push([position, window[1]]);
   return free;
 }

-export function capacity(minutes: number, reserve: number = 0.1, resource?: string) {
+export function capacityCompatible(minutes: number, reserve: number = 0.1, resource?: string) {
   const occupied = duration(minutes, reserve, resource);
   const available = Math.max(0, 480 - occupied / minuteUnit);
   return { occupied, available };
 }
+export function capacity(minutes: number, reserve: number = 0.1, resource?: string) {
+  const occupied = duration(minutes, reserve, resource);
+  const available = Math.max(0, 480 - occupied / minuteUnit);
+  return { available };
+}

 export function align(value: number, step: number) {
   if (step <= 0) throw new RangeError("step");
   return Math.ceil(value / step) * step;
```

## safe / rightOnly

```diff
Index: src/intervals.ts
===================================================================
--- src/intervals.ts
+++ src/intervals.ts
@@ -60,6 +60,8 @@
   return outer[0] <= inner[0] && inner[1] <= outer[1];
 }

 export function freeMinutes(minutes: number): number {
+  // 检查当前业务输入。
+
   return capacity(minutes, 0.1, "room").available;
 }
```
