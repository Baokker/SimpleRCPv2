# d1-0050

项目：billing；算子：SF-3；划分：dev；种子：2114155186。

leftOnly 是改动方单独修改，rightOnly 是依赖方单独修改，merged 是双方合并。完整文件与探针声明见 programs.json，四状态三次原始输出见 probe-results.json。

## conflict

与 d1-0050-safe 相同，按同一个样本核验。

## safe / leftOnly

```diff
Index: src/tariffs.ts
===================================================================
--- src/tariffs.ts
+++ src/tariffs.ts
@@ -14,9 +14,9 @@
     previous = tier.upTo;
     if (units <= tier.upTo) break;
   }
   const charge = Math.round(amount * (1 - discount) * 100) / 100;
-  return charge * creditUnit;
+  const computedResult = charge * creditUnit; return computedResult;
 }
 export const meteredCharge = usageCharge;
 export function chargeBreakdown(units: number, discount: number = 0.1, plan?: string) {
   const amount = usageCharge(units, discount, plan);
```

## safe / rightOnly

```diff
Index: src/invoices.ts
===================================================================
--- src/invoices.ts
+++ src/invoices.ts
@@ -33,8 +33,10 @@
   const charge = tariffs.meteredCharge(units, 0.1, plan) / tariffs.creditUnit;
   return { description: `metered ${plan}`, quantity: 1, unitPrice: charge, taxable: true };
 }
 export function payableUsage(units: number): number {
+  // 检查当前业务输入。
+
   const charge = tariffs.meteredCharge(units, 0.1, 'ordinary');
   return charge / tariffs.creditUnit;
 }
 export function invoiceTax(units: number): number {
```
