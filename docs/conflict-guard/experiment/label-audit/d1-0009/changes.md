# d1-0009

项目：access；算子：IC-2；划分：holdout；种子：1699223608。

leftOnly 是改动方单独修改，rightOnly 是依赖方单独修改，merged 是双方合并。完整文件与探针声明见 programs.json，四状态三次原始输出见 probe-results.json。

## conflict / leftOnly

```diff
Index: src/policy.ts
===================================================================
--- src/policy.ts
+++ src/policy.ts
@@ -20,9 +20,9 @@
   const roles = inheritedRoles(subject.roles, table);
   const matching = rules.filter((rule) => roles.has(rule.role) && rule.action === action && rule.resource === resource && (!rule.tenant || rule.tenant === subject.tenant));
   matching.sort((a, b) => b.priority - a.priority || Number(b.effect === 'deny') - Number(a.effect === 'deny') || a.id.localeCompare(b.id));
   const selected = matching[0];
-  return { allowed: selected?.effect === 'allow', rule: selected?.id, evaluated: matching.map((rule) => rule.id), risk: risk.assessment(subject.attempts, 0.1, 'internal').score };
+  return { allowed: selected?.effect === 'allow', rule: selected?.id, evaluated: matching.map((rule) => rule.id), risk: risk.assessmentCompatible(subject.attempts, 0.1, 'internal').score };
 }
 export function reviewPriority(attempts: number): number {
   const score = risk.calculateRisk(attempts, 0.1, 'public');
   return score / risk.riskUnit;
```

```diff
Index: src/risk.ts
===================================================================
--- src/risk.ts
+++ src/risk.ts
@@ -7,13 +7,18 @@
   const score = Math.max(0, exposure - trust * 20 + adjustment);
   return score * riskUnit;
 }
 export const calculateRisk = riskScore;
-export function assessment(attempts: number, trust: number = 0.1, context?: string) {
+export function assessmentCompatible(attempts: number, trust: number = 0.1, context?: string) {
   const score = riskScore(attempts, trust, context);
   const clearance = Math.max(0, 100 - score / riskUnit);
   return { score, clearance };
 }
+export function assessment(attempts: number, trust: number = 0.1, context?: string) {
+  const score = riskScore(attempts, trust, context);
+  const clearance = Math.max(0, 100 - score / riskUnit);
+  return { clearance };
+}
 export function clearanceValue(attempts: number): number {
   return assessment(attempts, 0.1, 'internal').clearance;
 }
 export function escalationCost(attempts: number): number {
```

## conflict / rightOnly

```diff
Index: src/policy.ts
===================================================================
--- src/policy.ts
+++ src/policy.ts
@@ -27,9 +27,11 @@
   const score = risk.calculateRisk(attempts, 0.1, 'public');
   return score / risk.riskUnit;
 }
 export function accessMargin(attempts: number): number {
-  return risk.assessment(attempts, 0.1, 'public').clearance;
+  // 检查当前业务输入。
+
+  return risk.assessment(attempts, 0.1, 'public').score;
 }
 export function explain(subject: Subject, action: string, resource: string, table: RoleTable, rules: Rule[]) {
   const result = decide(subject, action, resource, table, rules);
   const phrase = result.allowed ? 'granted' : 'denied';
```

## safe / leftOnly

```diff
Index: src/policy.ts
===================================================================
--- src/policy.ts
+++ src/policy.ts
@@ -20,9 +20,9 @@
   const roles = inheritedRoles(subject.roles, table);
   const matching = rules.filter((rule) => roles.has(rule.role) && rule.action === action && rule.resource === resource && (!rule.tenant || rule.tenant === subject.tenant));
   matching.sort((a, b) => b.priority - a.priority || Number(b.effect === 'deny') - Number(a.effect === 'deny') || a.id.localeCompare(b.id));
   const selected = matching[0];
-  return { allowed: selected?.effect === 'allow', rule: selected?.id, evaluated: matching.map((rule) => rule.id), risk: risk.assessment(subject.attempts, 0.1, 'internal').score };
+  return { allowed: selected?.effect === 'allow', rule: selected?.id, evaluated: matching.map((rule) => rule.id), risk: risk.assessmentCompatible(subject.attempts, 0.1, 'internal').score };
 }
 export function reviewPriority(attempts: number): number {
   const score = risk.calculateRisk(attempts, 0.1, 'public');
   return score / risk.riskUnit;
```

```diff
Index: src/risk.ts
===================================================================
--- src/risk.ts
+++ src/risk.ts
@@ -7,13 +7,18 @@
   const score = Math.max(0, exposure - trust * 20 + adjustment);
   return score * riskUnit;
 }
 export const calculateRisk = riskScore;
-export function assessment(attempts: number, trust: number = 0.1, context?: string) {
+export function assessmentCompatible(attempts: number, trust: number = 0.1, context?: string) {
   const score = riskScore(attempts, trust, context);
   const clearance = Math.max(0, 100 - score / riskUnit);
   return { score, clearance };
 }
+export function assessment(attempts: number, trust: number = 0.1, context?: string) {
+  const score = riskScore(attempts, trust, context);
+  const clearance = Math.max(0, 100 - score / riskUnit);
+  return { clearance };
+}
 export function clearanceValue(attempts: number): number {
   return assessment(attempts, 0.1, 'internal').clearance;
 }
 export function escalationCost(attempts: number): number {
```

## safe / rightOnly

```diff
Index: src/policy.ts
===================================================================
--- src/policy.ts
+++ src/policy.ts
@@ -27,8 +27,10 @@
   const score = risk.calculateRisk(attempts, 0.1, 'public');
   return score / risk.riskUnit;
 }
 export function accessMargin(attempts: number): number {
+  // 检查当前业务输入。
+
   return risk.assessment(attempts, 0.1, 'public').clearance;
 }
 export function explain(subject: Subject, action: string, resource: string, table: RoleTable, rules: Rule[]) {
   const result = decide(subject, action, resource, table, rules);
```
