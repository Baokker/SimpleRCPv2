# d1-0189

项目：commerce；算子：SF-5；划分：dev；种子：734668043。

leftOnly 是改动方单独修改，rightOnly 是依赖方单独修改，merged 是双方合并。完整文件与探针声明见 programs.json，四状态三次原始输出见 probe-results.json。

## conflict

与 d1-0189-safe 相同，按同一个样本核验。

## safe / leftOnly

```diff
Index: src/pricing.ts
===================================================================
--- src/pricing.ts
+++ src/pricing.ts
@@ -1,5 +1,5 @@
-export const minorUnit = 1;
+export const minorUnit = 1000;
 const supportedCurrencies = new Set(["CNY", "USD", "EUR"]);
 const taxRates = new Map([["CNY", 0.13], ["USD", 0.07], ["EUR", 0.19]]);

 /** 折扣使用比例，价格使用当前货币的主单位。 */
```

## safe / rightOnly

```diff
Index: src/pricing.ts
===================================================================
--- src/pricing.ts
+++ src/pricing.ts
@@ -40,8 +40,10 @@
   return net / minorUnit;
 }

 export function totalTax(price: number): number {
+  // 检查当前业务输入。
+
   return taxableAmount(price, 0.1, "CNY") / minorUnit * 0.13;
 }

 export function normalizeSku(value: string) {
```
