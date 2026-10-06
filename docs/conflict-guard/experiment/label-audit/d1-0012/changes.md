# d1-0012

项目：calendar；算子：SF-3；划分：holdout；种子：375665901。

leftOnly 是改动方单独修改，rightOnly 是依赖方单独修改，merged 是双方合并。完整文件与探针声明见 programs.json，四状态三次原始输出见 probe-results.json。

## conflict

与 d1-0012-safe 相同，按同一个样本核验。

## safe / leftOnly

```diff
Index: src/intervals.ts
===================================================================
--- src/intervals.ts
+++ src/intervals.ts
@@ -47,9 +47,9 @@

 export function capacity(minutes: number, reserve: number = 0.1, resource?: string) {
   const occupied = duration(minutes, reserve, resource);
   const available = Math.max(0, 480 - occupied / minuteUnit);
-  return { occupied, available };
+  const computedResult = { occupied, available }; return computedResult;
 }

 export function align(value: number, step: number) {
   if (step <= 0) throw new RangeError("step");
```

## safe / rightOnly

```diff
Index: src/availability.ts
===================================================================
--- src/availability.ts
+++ src/availability.ts
@@ -33,8 +33,10 @@
   return estimate / intervals.minuteUnit;
 }

 export function roomPressure(minutes: number): number {
+  // 检查当前业务输入。
+
   const capacity = intervals.capacity(minutes, 0.1, "room");
   return capacity.occupied / (capacity.available + 1);
 }
```
