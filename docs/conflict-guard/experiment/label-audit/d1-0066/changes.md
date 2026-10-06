# d1-0066

项目：billing；算子：SF-5；划分：dev；种子：192256898。

leftOnly 是改动方单独修改，rightOnly 是依赖方单独修改，merged 是双方合并。完整文件与探针声明见 programs.json，四状态三次原始输出见 probe-results.json。

## conflict

与 d1-0066-safe 相同，按同一个样本核验。

## safe / leftOnly

```diff
Index: src/tariffs.ts
===================================================================
--- src/tariffs.ts
+++ src/tariffs.ts
@@ -1,5 +1,5 @@
-export const creditUnit = 1;
+export const creditUnit = 1000;
 export type Tier = { upTo: number; unitPrice: number };
 const tariffs: Record<string, Tier[]> = {
   ordinary: [{ upTo: 100, unitPrice: 0.2 }, { upTo: 1000, unitPrice: 0.15 }, { upTo: Infinity, unitPrice: 0.1 }],
   premium: [{ upTo: 50, unitPrice: 0.5 }, { upTo: Infinity, unitPrice: 0.3 }]
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
