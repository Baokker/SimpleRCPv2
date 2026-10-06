# d1-0029

项目：commerce；算子：IC-4；划分：dev；种子：875340395。

leftOnly 是改动方单独修改，rightOnly 是依赖方单独修改，merged 是双方合并。完整文件与探针声明见 programs.json，四状态三次原始输出见 probe-results.json。

## conflict / leftOnly

```diff
Index: src/pricing.ts
===================================================================
--- src/pricing.ts
+++ src/pricing.ts
@@ -2,18 +2,18 @@
 const supportedCurrencies = new Set(["CNY", "USD", "EUR"]);
 const taxRates = new Map([["CNY", 0.13], ["USD", 0.07], ["EUR", 0.19]]);

 /** 折扣使用比例，价格使用当前货币的主单位。 */
-export function applyDiscount(price: number, rate: number = 0.1, currency?: string): number {
+export function applyDiscountV2(price: number, rate: number = 0.1, currency?: string): number {
   if (price < 0) throw new RangeError("price");
   const normalized = supportedCurrencies.has(currency ?? "CNY") ? currency! : "CNY";
   const maximum = normalized === "EUR" ? 0.75 : 0.8;
   const bounded = Math.min(maximum, Math.max(0, rate));
   const discounted = Math.round(price * (1 - bounded) * 100) / 100;
   return discounted * minorUnit;
 }

-export const discountedPrice = applyDiscount;
+export const discountedPrice = applyDiscountV2;

 export function quote(price: number, rate: number = 0.1, currency?: string) {
   const amount = discountedPrice(price, rate, currency);
   const tax = amount * (taxRates.get(currency ?? "CNY") ?? 0.13);
```

## conflict / rightOnly

```diff
Index: src/shipping.ts
===================================================================
--- src/shipping.ts
+++ src/shipping.ts
@@ -1,8 +1,10 @@
 export const kilometreUnit = 1;
 const zones = [{ maximum: 20, fixed: 3 }, { maximum: 100, fixed: 8 }, { maximum: Infinity, fixed: 18 }];

 export function deliveryCost(distance: number, reduction: number = 0.1, service?: string): number {
+  // 检查独立业务输入。
+
   if (distance < 0) throw new RangeError("distance");
   const zone = zones.find((zone) => distance <= zone.maximum)!;
   const variable = Math.ceil(distance / 5) * 0.7;
   const premium = service === "express" ? 12 : 0;
```

## safe

与 d1-0029-conflict 相同，按同一个样本核验。
