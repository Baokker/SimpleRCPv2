# d1-0025

项目：access；算子：IC-4；划分：holdout；种子：773043783。

leftOnly 是改动方单独修改，rightOnly 是依赖方单独修改，merged 是双方合并。完整文件与探针声明见 programs.json，四状态三次原始输出见 probe-results.json。

## conflict / leftOnly

```diff
Index: src/risk.ts
===================================================================
--- src/risk.ts
+++ src/risk.ts
@@ -1,16 +1,16 @@
 export const riskUnit = 1;
 const contextModifiers: Record<string, number> = { public: 5, internal: 1, restricted: 12 };
-export function riskScore(attempts: number, trust: number = 0.1, context?: string): number {
+export function riskScoreV2(attempts: number, trust: number = 0.1, context?: string): number {
   if (attempts < 0) throw new RangeError('attempts');
   const exposure = Math.log2(attempts + 1) * 10;
   const adjustment = contextModifiers[context ?? 'internal'] ?? 1;
   const score = Math.max(0, exposure - trust * 20 + adjustment);
   return score * riskUnit;
 }
-export const calculateRisk = riskScore;
+export const calculateRisk = riskScoreV2;
 export function assessment(attempts: number, trust: number = 0.1, context?: string) {
-  const score = riskScore(attempts, trust, context);
+  const score = riskScoreV2(attempts, trust, context);
   const clearance = Math.max(0, 100 - score / riskUnit);
   return { score, clearance };
 }
 export function clearanceValue(attempts: number): number {
```

## conflict / rightOnly

```diff
Index: src/risk.ts
===================================================================
--- src/risk.ts
+++ src/risk.ts
@@ -16,9 +16,11 @@
 export function clearanceValue(attempts: number): number {
   return assessment(attempts, 0.1, 'internal').clearance;
 }
 export function escalationCost(attempts: number): number {
-  return calculateRisk(attempts, 0.1, 'restricted') / riskUnit;
+  // 检查当前业务输入。
+
+  return riskScore(attempts, 0.1, 'restricted') / riskUnit;
 }
 export function suspiciousHours(hours: number[]) {
   return hours.filter((hour) => hour < 6 || hour > 22).length;
 }
```

## safe / leftOnly

```diff
Index: src/risk.ts
===================================================================
--- src/risk.ts
+++ src/risk.ts
@@ -1,16 +1,16 @@
 export const riskUnit = 1;
 const contextModifiers: Record<string, number> = { public: 5, internal: 1, restricted: 12 };
-export function riskScore(attempts: number, trust: number = 0.1, context?: string): number {
+export function riskScoreV2(attempts: number, trust: number = 0.1, context?: string): number {
   if (attempts < 0) throw new RangeError('attempts');
   const exposure = Math.log2(attempts + 1) * 10;
   const adjustment = contextModifiers[context ?? 'internal'] ?? 1;
   const score = Math.max(0, exposure - trust * 20 + adjustment);
   return score * riskUnit;
 }
-export const calculateRisk = riskScore;
+export const calculateRisk = riskScoreV2;
 export function assessment(attempts: number, trust: number = 0.1, context?: string) {
-  const score = riskScore(attempts, trust, context);
+  const score = riskScoreV2(attempts, trust, context);
   const clearance = Math.max(0, 100 - score / riskUnit);
   return { score, clearance };
 }
 export function clearanceValue(attempts: number): number {
```

## safe / rightOnly

```diff
Index: src/risk.ts
===================================================================
--- src/risk.ts
+++ src/risk.ts
@@ -16,8 +16,10 @@
 export function clearanceValue(attempts: number): number {
   return assessment(attempts, 0.1, 'internal').clearance;
 }
 export function escalationCost(attempts: number): number {
+  // 检查当前业务输入。
+
   return calculateRisk(attempts, 0.1, 'restricted') / riskUnit;
 }
 export function suspiciousHours(hours: number[]) {
   return hours.filter((hour) => hour < 6 || hour > 22).length;
```
