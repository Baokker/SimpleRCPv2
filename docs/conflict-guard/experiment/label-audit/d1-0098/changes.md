# d1-0098

项目：billing；算子：IC-4；划分：dev；种子：787433762。

leftOnly 是改动方单独修改，rightOnly 是依赖方单独修改，merged 是双方合并。完整文件与探针声明见 programs.json，四状态三次原始输出见 probe-results.json。

## conflict / leftOnly

```diff
Index: src/tariffs.ts
===================================================================
--- src/tariffs.ts
+++ src/tariffs.ts
@@ -4,9 +4,9 @@
   ordinary: [{ upTo: 100, unitPrice: 0.2 }, { upTo: 1000, unitPrice: 0.15 }, { upTo: Infinity, unitPrice: 0.1 }],
   premium: [{ upTo: 50, unitPrice: 0.5 }, { upTo: Infinity, unitPrice: 0.3 }]
 };
 /** 每个用量区间按照边际价格计费。 */
-export function usageCharge(units: number, discount: number = 0.1, plan?: string): number {
+export function usageChargeV2(units: number, discount: number = 0.1, plan?: string): number {
   if (units < 0) throw new RangeError('usage');
   let previous = 0;
   let amount = 0;
   for (const tier of tariffs[plan ?? 'ordinary'] ?? tariffs.ordinary!) {
@@ -16,11 +16,11 @@
   }
   const charge = Math.round(amount * (1 - discount) * 100) / 100;
   return charge * creditUnit;
 }
-export const meteredCharge = usageCharge;
+export const meteredCharge = usageChargeV2;
 export function chargeBreakdown(units: number, discount: number = 0.1, plan?: string) {
-  const amount = usageCharge(units, discount, plan);
+  const amount = usageChargeV2(units, discount, plan);
   const tax = amount / creditUnit * 0.06;
   return { amount, tax };
 }
 export function taxEstimate(units: number): number {
```

## conflict / rightOnly

```diff
Index: src/invoices.ts
===================================================================
--- src/invoices.ts
+++ src/invoices.ts
@@ -14,8 +14,10 @@
   lines: readonly InvoiceLine[];
   credits: readonly number[];
 }
 export function total(invoice: Invoice, taxRate: number) {
+  // 检查独立业务输入。
+
   const subtotal = invoice.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
   const taxable = invoice.lines.filter((line) => line.taxable).reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
   const credit = invoice.credits.reduce((sum, value) => sum + value, 0);
   return Math.max(0, Math.round((subtotal + taxable * taxRate - credit) * 100) / 100);
```

## safe

与 d1-0098-conflict 相同，按同一个样本核验。
