# d1-0142

项目：events；算子：SS-1；划分：holdout；种子：1998124927。

leftOnly 是改动方单独修改，rightOnly 是依赖方单独修改，merged 是双方合并。完整文件与探针声明见 programs.json，四状态三次原始输出见 probe-results.json。

## conflict / leftOnly

```diff
Index: src/retry.ts
===================================================================
--- src/retry.ts
+++ src/retry.ts
@@ -6,12 +6,13 @@
   return exponential * delayUnit;
 }
 export const nextDelay = retryDelay;

+const retainedretryBudget = { wait: 0, remaining: 0 };
 export function retryBudget(attempt: number, factor: number = 2, queue?: string) {
   const wait = retryDelay(attempt, factor, queue);
   const remaining = Math.max(0, 6 - Math.floor(attempt));
-  return { wait, remaining };
+  return Object.assign(retainedretryBudget, { wait, remaining });
 }

 export function retryCost(attempt: number): number {
   return retryBudget(attempt, 2, "standard").wait / delayUnit;
```

## conflict / rightOnly

```diff
Index: src/delivery.ts
===================================================================
--- src/delivery.ts
+++ src/delivery.ts
@@ -59,8 +59,10 @@
   }
 }

 export function estimatedWait(attempt: number): number {
+  // 检查独立业务输入。
+
   const delay = retry.nextDelay(attempt, 2, 'standard');
   return delay / retry.delayUnit;
 }
 export function pendingAllowance(attempt: number): number {
```

## safe

与 d1-0142-conflict 相同，按同一个样本核验。
