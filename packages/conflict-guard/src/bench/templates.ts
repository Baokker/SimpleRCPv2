import type { BenchProbe } from "./types.js";

export interface OperatorTemplate {
  baseline: Record<string, string>;
  left: Record<string, string>;
  right: Record<string, string>;
  merged?: Record<string, string>;
  probes: BenchProbe[];
}

export function operatorTemplate(id: string, safe: boolean, salt: number): OperatorTemplate {
  const producer = "src/producer.ts";
  const consumer = "src/consumer.ts";
  const imports = 'import * as p from "./producer.js";\n';
  const checkout = (body: string) => `${imports}export async function checkout(price: number) { ${body} }\n`;
  const functionText = (body: string, parameters = "price: number, rate: number = 0.1") => `export function applyDiscount(${parameters}) { ${body} }\n`;
  const normal = "return price * (1 - rate);";
  let before = functionText(normal);
  let after = before;
  let beforeConsumer = checkout("return p.applyDiscount(price, 0.1);");
  let afterConsumer = checkout(`const value = p.applyDiscount(price, 0.1); return value + ${salt % 3};`);
  let leftExpression = "p.applyDiscount(100, 0.1)";
  let leftExpected: unknown = 90;
  let rightExpected: unknown = 90 + salt % 3;
  let rightExpression = "await c.checkout(100)";
  let regression = "Number.isFinite(Number(await p.applyDiscount(100, 0.1)))";
  let sameFile = false;
  let combined = "";
  if (id === "IC-1") {
    before = functionText(normal, "price: number, rate: number, currency?: string");
    after = functionText('if (!currency) throw new Error("currency required"); return price * (1 - rate);', "price: number, rate: number, currency: string");
    beforeConsumer = checkout('return p.applyDiscount(price, 0.1, "USD");');
    afterConsumer = checkout(`const value = p.applyDiscount(price, 0.1${safe ? ', "USD"' : ""}); return value;`);
    leftExpression = 'p.applyDiscount(100, 0.1, "USD")';
    regression = 'Number.isFinite(p.applyDiscount(100, 0.1, "USD"))';
    rightExpected = 90;
  } else if (id === "IC-2") {
    before = functionText("return { value: price * (1 - rate), amount: price * (1 - rate) };");
    after = functionText("return { amount: price * (1 - rate) };");
    beforeConsumer = checkout("return p.applyDiscount(price, 0.1).amount;");
    afterConsumer = checkout(`const value = p.applyDiscount(price, 0.1).${safe ? "amount" : "value"}; return value;`);
    leftExpression = 'Object.hasOwn(p.applyDiscount(100, 0.1), "value")'; leftExpected = false;
    regression = "p.applyDiscount(100, 0.1).amount === 90"; rightExpected = 90;
  } else if (id === "IC-3") {
    before = `export const unit = 1;\n${functionText(normal)}`;
    after = `export const unit = 1000;\n${functionText("return price * (1 - rate) * 1000;")}`;
    beforeConsumer = checkout("return p.applyDiscount(price, 0.1) / p.unit;");
    afterConsumer = checkout(`const value = p.applyDiscount(price, 0.1); return value / ${safe ? "p.unit" : "1"};`);
    leftExpected = 90000; rightExpected = 90;
  } else if (id === "CP-1") {
    before = functionText("const rules = [rate, rate / 2]; return price * (1 - rules[0]!);");
    after = functionText("const rules = [rate / 2, rate]; return price * (1 - rules[0]!);"); leftExpected = 95;
    afterConsumer = checkout(`const value = p.applyDiscount(price, 0.1); return value + ${safe ? "0" : "1"};`);
    rightExpression = "Number.isFinite(await c.checkout(100))"; rightExpected = true;
  } else if (id === "IC-4") {
    before += "export const discount = applyDiscount;\n";
    after = "export function applyDiscountV2(price: number, rate: number = 0.1) { return price * (1 - rate); }\nexport const discount = applyDiscountV2;\n";
    beforeConsumer = checkout("return p.discount(price, 0.1);");
    afterConsumer = checkout(`const value = p.${safe ? "discount" : "applyDiscount"}(price, 0.1); return value;`);
    leftExpression = 'typeof p.applyDiscount === "undefined"'; leftExpected = true;
    regression = "p.discount(100, 0.1) === 90"; rightExpected = 90;
  } else if (id === "CP-2") {
    after = functionText(normal, "price: number, rate: number = 0");
    afterConsumer = checkout(`const value = p.applyDiscount(price${safe ? ", 0.1" : ""}); return value;`);
    leftExpression = "p.applyDiscount(100)"; leftExpected = 100; rightExpected = 90;
  } else if (id === "CP-3") {
    after = functionText('if (rate > 0.2) throw new RangeError("rate"); return price * (1 - rate);');
    afterConsumer = checkout(`const value = p.applyDiscount(price, ${safe ? "0.15" : "0.5"}); return value;`);
    rightExpected = safe ? 85 : 50;
  } else if (id === "CP-4") {
    const state = "let calls = 0;\nexport function reset() { calls = 0; }\nexport function readCalls() { return calls; }\n";
    before = state + functionText("calls += 1; return price * (1 - rate);");
    after = state + functionText("if (price === 0) return 0; calls += 1; return price * (1 - rate);");
    afterConsumer = checkout(`p.reset(); p.applyDiscount(${safe ? "price" : "0"}, 0.1); return p.readCalls();`);
    leftExpression = "(p.reset(), p.applyDiscount(0, 0.1), p.readCalls())"; leftExpected = 0; rightExpected = 1;
  } else if (id === "SS-1") {
    const state = "const state = { value: 0 };\nexport function reset() { state.value = 0; }\n";
    before = state + functionText("return { value: price * (1 - rate) };");
    after = state + functionText("state.value = price * (1 - rate); return state;");
    beforeConsumer = checkout("return p.applyDiscount(price, 0.1).value;");
    afterConsumer = checkout(`const first = ${safe ? "{ ...p.applyDiscount(price, 0.1) }" : "p.applyDiscount(price, 0.1)"}; p.applyDiscount(price * 2, 0.1); return first.value;`);
    leftExpression = "p.applyDiscount(100, 0.1) === p.applyDiscount(200, 0.1)"; leftExpected = true;
    regression = "p.applyDiscount(100, 0.1).value === 90"; rightExpected = 90;
  } else if (id === "SS-2") {
    const state = "let configuredRate = 0.1;\nexport function reset() { configuredRate = 0.1; }\nexport function setRate(value: number) { configuredRate = value; }\n";
    before = state + "export function initialize() {}\n" + functionText("return price * (1 - configuredRate);");
    after = state + "export function initialize() { configuredRate = 0.2; }\n" + functionText("return price * (1 - configuredRate);");
    beforeConsumer = checkout("p.initialize(); return p.applyDiscount(price);");
    afterConsumer = checkout(safe ? "p.initialize(); p.setRate(0.5); return p.applyDiscount(price);" : "p.setRate(0.5); p.initialize(); return p.applyDiscount(price);");
    leftExpression = "(p.reset(), p.initialize(), p.applyDiscount(100))"; leftExpected = 80; rightExpected = 50;
  } else if (id === "SS-3") {
    const state = "let entries: number[] = [];\nexport function reset() { entries = []; }\nexport function size() { return entries.length; }\n";
    before = state + functionText("entries = [price]; return price * (1 - rate);");
    after = state + functionText("entries.push(price); return price * (1 - rate);");
    afterConsumer = checkout(`p.reset(); p.applyDiscount(price); ${safe ? "if (p.size() === 0) " : ""}p.applyDiscount(price); return p.size();`);
    leftExpression = "(p.reset(), p.applyDiscount(100), p.applyDiscount(200), p.size())"; leftExpected = 2; rightExpected = 1;
  } else if (id === "EB-1") {
    before = functionText('if (rate < 0) throw new RangeError("rate"); return price * (1 - rate);');
    after = functionText("if (rate < 0) return undefined; return price * (1 - rate);");
    afterConsumer = checkout(`try { const value = p.applyDiscount(price, -0.1); return ${safe ? "value ?? price" : "value"}; } catch { return price; }`);
    leftExpression = "p.applyDiscount(100, -0.1) === undefined"; leftExpected = true; rightExpected = 100;
  } else if (id === "EB-2") {
    after = "export async function applyDiscount(price: number, rate: number = 0.1) { return price * (1 - rate); }\n";
    beforeConsumer = checkout("return await p.applyDiscount(price, 0.1);");
    afterConsumer = checkout(`return ${safe ? "(await p.applyDiscount(price, 0.1))" : "p.applyDiscount(price, 0.1)"} + 1;`);
    leftExpression = "p.applyDiscount(100) instanceof Promise"; leftExpected = true; rightExpected = 91;
  } else if (id === "SF-1") after = functionText('console.log("audit"); return price * (1 - rate);');
  else if (id === "SF-2") after = functionText("/* discount */ return price * (1 - rate);");
  else if (id === "SF-3") after = functionText("const result = price * (1 - rate); return result;");
  else if (id === "SF-4") {
    before += "export function unrelated() { return 1; }\n";
    after = functionText("const result = price * (1 - rate); return result;") + "export function unrelated() { return 1; }\n";
    afterConsumer = before.replace("return 1;", "return 2;");
    rightExpression = "c.unrelated()"; rightExpected = 2;
    sameFile = true; combined = after.replace("return 1;", "return 2;");
  } else if (id === "SF-5") {
    before = functionText("if (price < 0) return 0; return price * (1 - rate);");
    after = functionText("if (price < 0) return -1; return price * (1 - rate);");
    afterConsumer = before.replace("price * (1 - rate)", "price * (1 - rate) + 1");
    leftExpression = "p.applyDiscount(-1)"; leftExpected = -1;
    rightExpression = "c.applyDiscount(100, 0.1)"; rightExpected = 91;
    sameFile = true; combined = after.replace("price * (1 - rate)", "price * (1 - rate) + 1");
  } else throw new Error(`未知算子：${id}`);
  const baseline = { [producer]: before, [consumer]: sameFile ? 'export * from "./producer.js";\n' : beforeConsumer };
  const left = { [producer]: after };
  const right = { [sameFile ? producer : consumer]: afterConsumer };
  return { baseline, left, right, ...(sameFile ? { merged: { [producer]: combined } } : {}), probes: [
    { id: "left-intent", owner: "origin-intent", expression: leftExpression, expected: leftExpected, statement: "改动方的新行为成立。" },
    { id: "right-intent", owner: "candidate-intent", expression: rightExpression, expected: rightExpected, statement: "依赖方的行为成立。" },
    { id: "regression", owner: "shared-regression", expression: regression, expected: true, statement: "正常输入仍产生有效结果。" },
    { id: "observation", owner: "observation", expression: "typeof c.checkout === 'function' ? await c.checkout(100) : c.applyDiscount(100, 0.1)", statement: "记录共享输出。" }
  ] };
}
