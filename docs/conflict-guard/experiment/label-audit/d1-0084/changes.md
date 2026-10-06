# d1-0084

项目：calendar；算子：SS-1；划分：holdout；种子：253742932。

leftOnly 是改动方单独修改，rightOnly 是依赖方单独修改，merged 是双方合并。完整文件与探针声明见 programs.json，四状态三次原始输出见 probe-results.json。

## conflict / leftOnly

```diff
Index: src/intervals.ts
===================================================================
--- src/intervals.ts
+++ src/intervals.ts
@@ -44,12 +44,13 @@
   if (position < window[1]) free.push([position, window[1]]);
   return free;
 }

+const retainedcapacity = { occupied: 0, available: 0 };
 export function capacity(minutes: number, reserve: number = 0.1, resource?: string) {
   const occupied = duration(minutes, reserve, resource);
   const available = Math.max(0, 480 - occupied / minuteUnit);
-  return { occupied, available };
+  return Object.assign(retainedcapacity, { occupied, available });
 }

 export function align(value: number, step: number) {
   if (step <= 0) throw new RangeError("step");
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

与 d1-0084-conflict 相同，按同一个样本核验。
