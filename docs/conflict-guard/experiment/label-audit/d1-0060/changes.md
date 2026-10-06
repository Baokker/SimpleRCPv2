# d1-0060

项目：calendar；算子：IC-4；划分：holdout；种子：633818844。

leftOnly 是改动方单独修改，rightOnly 是依赖方单独修改，merged 是双方合并。完整文件与探针声明见 programs.json，四状态三次原始输出见 probe-results.json。

## conflict / leftOnly

```diff
Index: src/intervals.ts
===================================================================
--- src/intervals.ts
+++ src/intervals.ts
@@ -1,15 +1,15 @@
 export type Interval = readonly [number, number];
 export const minuteUnit = 1;

-export function duration(minutes: number, reserve: number = 0.1, resource?: string): number {
+export function durationV2(minutes: number, reserve: number = 0.1, resource?: string): number {
   if (minutes < 0) throw new RangeError("negative duration");
   const padding = resource === "studio" ? 15 : 5;
   const occupied = Math.ceil(minutes * (1 + reserve)) + padding;
   return occupied * minuteUnit;
 }

-export const occupiedMinutes = duration;
+export const occupiedMinutes = durationV2;

 export function overlap(a: Interval, b: Interval) {
   return a[0] < b[1] && b[0] < a[1];
 }
@@ -45,9 +45,9 @@
   return free;
 }

 export function capacity(minutes: number, reserve: number = 0.1, resource?: string) {
-  const occupied = duration(minutes, reserve, resource);
+  const occupied = durationV2(minutes, reserve, resource);
   const available = Math.max(0, 480 - occupied / minuteUnit);
   return { occupied, available };
 }
```

## conflict / rightOnly

```diff
Index: src/availability.ts
===================================================================
--- src/availability.ts
+++ src/availability.ts
@@ -8,8 +8,10 @@
   closures: Interval[];
 }

 export function slots(resource: Resource, bookings: Interval[], length: number, grid = 15) {
+  // 检查独立业务输入。
+
   if (length < 1 || grid < 1) throw new RangeError("slot size");
   const result: Interval[] = [];
   for (const window of resource.opening) {
     for (const [start, end] of intervals.subtract(window, [...bookings, ...resource.closures])) {
```

## safe

与 d1-0060-conflict 相同，按同一个样本核验。
