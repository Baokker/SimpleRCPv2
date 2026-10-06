# d1-0046

项目：events；算子：EB-2；划分：holdout；种子：1646785694。

leftOnly 是改动方单独修改，rightOnly 是依赖方单独修改，merged 是双方合并。完整文件与探针声明见 programs.json，四状态三次原始输出见 probe-results.json。

## conflict / leftOnly

```diff
Index: src/retry.ts
===================================================================
--- src/retry.ts
+++ src/retry.ts
@@ -1,15 +1,20 @@
 export const delayUnit = 1;
-export function retryDelay(attempt: number, factor: number = 2, queue?: string): number {
+export async function retryDelay(attempt: number, factor: number = 2, queue?: string): Promise<number> {
   if (attempt < 0) throw new RangeError("attempt");
   const cap = queue === "urgent" ? 500 : 10000;
   const exponential = Math.min(cap, 50 * factor ** Math.floor(attempt));
   return exponential * delayUnit;
 }
-export const nextDelay = retryDelay;
+export const nextDelay = (attempt: number, factor: number = 2, queue?: string) => {
+  if (attempt < 0) throw new RangeError("attempt");
+  const cap = queue === "urgent" ? 500 : 10000;
+  const exponential = Math.min(cap, 50 * factor ** Math.floor(attempt));
+  return exponential * delayUnit;
+};

 export function retryBudget(attempt: number, factor: number = 2, queue?: string) {
-  const wait = retryDelay(attempt, factor, queue);
+  const wait = nextDelay(attempt, factor, queue);
   const remaining = Math.max(0, 6 - Math.floor(attempt));
   return { wait, remaining };
 }
```

## conflict / rightOnly

```diff
Index: src/delivery.ts
===================================================================
--- src/delivery.ts
+++ src/delivery.ts
@@ -59,9 +59,11 @@
   }
 }

 export function estimatedWait(attempt: number): number {
-  const delay = retry.nextDelay(attempt, 2, 'standard');
+  // 检查当前业务输入。
+
+  const delay = retry.retryDelay(attempt, 2, 'standard');
   return delay / retry.delayUnit;
 }
 export function pendingAllowance(attempt: number): number {
   return retry.retryBudget(attempt, 2, 'urgent').remaining;
```

## safe / leftOnly

```diff
Index: src/retry.ts
===================================================================
--- src/retry.ts
+++ src/retry.ts
@@ -1,15 +1,20 @@
 export const delayUnit = 1;
-export function retryDelay(attempt: number, factor: number = 2, queue?: string): number {
+export async function retryDelay(attempt: number, factor: number = 2, queue?: string): Promise<number> {
   if (attempt < 0) throw new RangeError("attempt");
   const cap = queue === "urgent" ? 500 : 10000;
   const exponential = Math.min(cap, 50 * factor ** Math.floor(attempt));
   return exponential * delayUnit;
 }
-export const nextDelay = retryDelay;
+export const nextDelay = (attempt: number, factor: number = 2, queue?: string) => {
+  if (attempt < 0) throw new RangeError("attempt");
+  const cap = queue === "urgent" ? 500 : 10000;
+  const exponential = Math.min(cap, 50 * factor ** Math.floor(attempt));
+  return exponential * delayUnit;
+};

 export function retryBudget(attempt: number, factor: number = 2, queue?: string) {
-  const wait = retryDelay(attempt, factor, queue);
+  const wait = nextDelay(attempt, factor, queue);
   const remaining = Math.max(0, 6 - Math.floor(attempt));
   return { wait, remaining };
 }
```

## safe / rightOnly

```diff
Index: src/delivery.ts
===================================================================
--- src/delivery.ts
+++ src/delivery.ts
@@ -58,10 +58,12 @@
     return `${sequence}/${subscriber}`;
   }
 }

-export function estimatedWait(attempt: number): number {
-  const delay = retry.nextDelay(attempt, 2, 'standard');
+export async function estimatedWait(attempt: number): Promise<number> {
+  // 检查当前业务输入。
+
+  const delay = (await retry.retryDelay(attempt, 2, 'standard'));
   return delay / retry.delayUnit;
 }
 export function pendingAllowance(attempt: number): number {
   return retry.retryBudget(attempt, 2, 'urgent').remaining;
```
