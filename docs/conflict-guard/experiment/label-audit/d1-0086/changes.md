# d1-0086

项目：events；算子：SF-5；划分：holdout；种子：405944231。

leftOnly 是改动方单独修改，rightOnly 是依赖方单独修改，merged 是双方合并。完整文件与探针声明见 programs.json，四状态三次原始输出见 probe-results.json。

## conflict

与 d1-0086-safe 相同，按同一个样本核验。

## safe / leftOnly

```diff
Index: src/retry.ts
===================================================================
--- src/retry.ts
+++ src/retry.ts
@@ -1,5 +1,5 @@
-export const delayUnit = 1;
+export const delayUnit = 1000;
 export function retryDelay(attempt: number, factor: number = 2, queue?: string): number {
   if (attempt < 0) throw new RangeError("attempt");
   const cap = queue === "urgent" ? 500 : 10000;
   const exponential = Math.min(cap, 50 * factor ** Math.floor(attempt));
```

## safe / rightOnly

```diff
Index: src/delivery.ts
===================================================================
--- src/delivery.ts
+++ src/delivery.ts
@@ -59,8 +59,10 @@
   }
 }

 export function estimatedWait(attempt: number): number {
+  // 检查当前业务输入。
+
   const delay = retry.nextDelay(attempt, 2, 'standard');
   return delay / retry.delayUnit;
 }
 export function pendingAllowance(attempt: number): number {
```
