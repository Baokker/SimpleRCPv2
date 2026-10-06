import * as ts from "typescript";
import { createSemanticIndex } from "../semantic/index.js";
import type { BenchProbe, SeedProject } from "./types.js";

interface TextEdit { start: number; end: number; text: string }
interface Site {
  file: string;
  source: ts.SourceFile;
  producer: ts.FunctionDeclaration;
  consumerFile: string;
  consumerSource: ts.SourceFile;
  consumer: ts.FunctionDeclaration;
  call: ts.CallExpression;
  namespace: string;
  numeric: ts.FunctionDeclaration;
  unit: string;
}

export interface OperatorTemplate {
  baseline: Record<string, string>;
  left: Record<string, string>;
  right: Record<string, string>;
  merged: Record<string, string>;
  probes: BenchProbe[];
  entryPoints: { producer: string; consumer: string };
  site: { producerKey: string; consumerKey: string; producerName: string; consumerName: string };
}

export function operatorTemplate(id: string, safe: boolean, salt: number, project: SeedProject, unrelated = false): OperatorTemplate {
  const site = findSite(project, ["IC-2", "SS-1"].includes(id), id === "CP-5", salt);
  const { source, producer, consumerSource, consumer, numeric } = site;
  const producerName = producer.name!.text;
  const numericName = numeric.name!.text;
  const consumerName = consumer.name!.text;
  const argument = 80 + salt % 61;
  const firstParameter = numeric.parameters[0]!.name.getText(source);
  const multiplier = numeric.parameters[1]!.name.getText(source);
  const context = numeric.parameters[2]!.name.getText(source);
  const sample = `${argument}, 0.1, "benchmark"`;
  const invoke = (prefix: string, args = sample, name = numericName) => `${prefix}.${name}(${args})`;
  const returnNode = directReturn(producer);
  const numericReturn = directReturn(numeric);
  const callerReturn = directReturn(consumer);
  const namespace = site.namespace;
  const leftEdits = new Map<string, TextEdit[]>();
  const rightEdits = new Map<string, TextEdit[]>();
  const add = (side: Map<string, TextEdit[]>, file: string, node: ts.Node, text: string) => {
    const edits = side.get(file) ?? [];
    edits.push({ start: node.getStart(node.getSourceFile()), end: node.getEnd(), text });
    side.set(file, edits);
  };
  const insert = (side: Map<string, TextEdit[]>, file: string, start: number, text: string) => {
    const edits = side.get(file) ?? []; edits.push({ start, end: start, text }); side.set(file, edits);
  };
  const body = (statements: string) => add(rightEdits, site.consumerFile, consumer.body!, `{\n  ${statements}\n}`);
  const originalCall = site.call.getText(consumerSource);
  const callWith = (values: string, callee = site.call.expression.getText(consumerSource)) => `${callee}(${values})`;
  const inputName = consumer.parameters[0]!.name.getText(consumerSource);
  const callerExpression = callerReturn.expression!.getText(consumerSource);
  let leftExpression = invoke("p");
  let leftExpectedExpression = invoke("b");
  let rightExpression = `await c.${consumerName}(${argument})`;
  let rightExpectedExpression = `await d.${consumerName}(${argument})`;
  let rightExpected: unknown;
  let observation: BenchProbe | undefined;
  const delta = 1 + salt % 4;

  if (id === "IC-1") {
    const parameter = numeric.parameters[2]!;
    if (!parameter.questionToken) throw new Error("必填参数算子需要可选参数");
    add(leftEdits, site.file, parameter.questionToken, "");
    insert(leftEdits, site.file, numeric.body!.getStart(source) + 1, `\n  if (!${context}) throw new Error("context required");`);
    const updateExistingCall = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "evaluate" && node.arguments.length === 3) add(leftEdits, site.file, node.arguments[2]!, `${node.arguments[2]!.getText(source)} ?? "benchmark"`);
      ts.forEachChild(node, updateExistingCall);
    };
    updateExistingCall(source);
    body(`const value = ${callWith(safe ? `${inputName}, 0.1, "benchmark"` : `${inputName}, 0.1`)}; return value / ${namespace}.${site.unit};`);
  } else if (id === "IC-2") {
    if (!ts.isObjectLiteralExpression(returnNode.expression!)) throw new Error("返回字段算子需要对象返回值");
    const retained = returnNode.expression.properties.filter((property) => property.name?.getText(source) !== "value");
    add(leftEdits, site.file, returnNode.expression, `{ ${retained.map((property) => property.getText(source)).join(", ")} }`);
    leftExpression = `Object.hasOwn(${invoke("p", sample, producerName)}, "value")`;
    leftExpectedExpression = "false";
    body(`const quote = ${originalCall}; return quote.${safe ? "amount" : "value"} / ${namespace}.${site.unit};`);
  } else if (id === "IC-3" || id === "SF-5") {
    const unitDeclaration = source.statements.filter(ts.isVariableStatement).flatMap((statement) => statement.declarationList.declarations).find((declaration) => declaration.name.getText(source) === site.unit)!;
    add(leftEdits, site.file, unitDeclaration.initializer!, "1000");
    leftExpectedExpression = `(${invoke("b")}) * 1000`;
    body(`const value = ${originalCall}; return value / ${safe || id === "SF-5" ? `${namespace}.${site.unit}` : "1"};`);
  } else if (id === "IC-4") {
    const renamed = `${numericName}V2`;
    add(leftEdits, site.file, numeric.name!, renamed);
    const alias = source.statements.filter(ts.isVariableStatement).flatMap((statement) => statement.declarationList.declarations).find((declaration) => declaration.initializer?.getText(source) === numericName)!;
    add(leftEdits, site.file, alias.initializer!, renamed);
    leftExpression = `typeof p.${numericName}`; leftExpectedExpression = '"undefined"';
    body(`const value = ${callWith(`${inputName}, 0.1, "benchmark"`, `${namespace}.${safe ? alias.name.getText(source) : numericName}`)}; return value / ${namespace}.${site.unit};`);
  } else if (id === "CP-1") {
    const priorities = numeric.body!.statements.filter(ts.isVariableStatement).flatMap((statement) => statement.declarationList.declarations).find((declaration) => declaration.initializer && ts.isArrayLiteralExpression(declaration.initializer))!;
    const array = priorities.initializer as ts.ArrayLiteralExpression;
    add(leftEdits, site.file, array, `[${[...array.elements].reverse().map((element) => element.getText(source)).join(", ")}]`);
    leftExpectedExpression = invoke("b", `${argument}, 0.05, "benchmark"`);
    body(`const value = ${safe ? `${callWith(`${inputName}, 0, "benchmark"`)} / ${namespace}.${site.unit}` : callerExpression}; return value + ${delta};`);
    rightExpression = `Number.isFinite(await c.${consumerName}(${argument}))`; rightExpected = true;
    observation = { id: "priority-output", owner: "observation", expression: `await c.${consumerName}(${argument})`, expectedMergedExpression: safe ? `${invoke("b", `${argument}, 0, "benchmark"`)} / b.${site.unit} + ${delta}` : `await d.${consumerName}(${argument}) + ${delta}`, statement: "依赖方声明合并后的优先级输出。" };
  } else if (id === "CP-2") {
    add(leftEdits, site.file, numeric.parameters[1]!.initializer!, "0");
    leftExpression = invoke("p", `${argument}, undefined, "benchmark"`);
    leftExpectedExpression = invoke("b", `${argument}, 0, "benchmark"`);
    body(`return ${callWith(safe ? `${inputName}, 0.1, "benchmark"` : `${inputName}, undefined, "benchmark"`)} / ${namespace}.${site.unit};`);
  } else if (id === "CP-3") {
    insert(leftEdits, site.file, numeric.body!.getStart(source) + 1, `\n  if (${multiplier} > 0.2) throw new RangeError("multiplier");`);
    const rate = safe ? "0.15" : "0.5";
    body(`return ${callWith(`${inputName}, ${rate}, "benchmark"`)} / ${namespace}.${site.unit};`);
    rightExpectedExpression = `${invoke("b", `${argument}, ${rate}, "benchmark"`)} / b.${site.unit}`;
  } else if (id === "CP-4") {
    insert(leftEdits, site.file, numeric.body!.getStart(source) + 1, `\n  if (${firstParameter} === 0) return 0;`);
    leftExpression = `(p.reset(), ${invoke("p", '0, 0.1, "benchmark"')}, p.historySize())`; leftExpectedExpression = "0";
    body(`${namespace}.reset(); ${callWith(`${safe ? inputName : "0"}, 0.1, "benchmark"`)}; return ${namespace}.historySize();`);
    rightExpectedExpression = "1";
  } else if (id === "CP-5") {
    add(leftEdits, site.file, numericReturn.expression!, `(${numericReturn.expression!.getText(source)}) * 2`);
    leftExpectedExpression = `(${invoke("b")}) * 2`;
    if (!ts.isObjectLiteralExpression(callerReturn.expression!)) throw new Error("同文件算子需要返回对象的调用方");
    add(rightEdits, site.consumerFile, callerReturn.expression!, `{ amount: amount${safe ? " / 2" : ""} + ${delta}, value: amount${safe ? " / 2" : ""} + ${delta} }`);
    rightExpression = safe ? `Math.abs(c.${consumerName}(${sample}).amount - (p.evaluate(${sample}) / 2 + ${delta})) < 1e-8` : `c.${consumerName}(${sample}).amount`;
    rightExpectedExpression = safe ? "true" : `d.${consumerName}(${sample}).amount + ${delta}`;
  } else if (id === "SS-1") {
    insert(leftEdits, site.file, producer.getStart(source), "const retainedQuote = { amount: 0, value: 0 };\n");
    add(leftEdits, site.file, returnNode.expression!, `Object.assign(retainedQuote, ${returnNode.expression!.getText(source)})`);
    leftExpression = `${invoke("p", sample, producerName)} === ${invoke("p", `${argument + 20}, 0.1, "benchmark"`, producerName)}`; leftExpectedExpression = "true";
    body(`const first = ${safe ? `{ ...${originalCall} }` : originalCall}; ${callWith(`${inputName} + 20, 0.1, "benchmark"`)}; return first.amount / ${namespace}.${site.unit};`);
  } else if (id === "SS-2") {
    const initializer = source.statements.filter(ts.isFunctionDeclaration).find((statement) => statement.name?.text === "initialize")!;
    add(leftEdits, site.file, initializer.body!, "{ configuration.rate = 0.2; }");
    leftExpression = `(p.initialize(), ${invoke("p", `${argument}, undefined, "benchmark"`)})`;
    leftExpectedExpression = invoke("b", `${argument}, 0.2, "benchmark"`);
    body(`${safe ? `${namespace}.initialize(); ${namespace}.configure(0.5);` : `${namespace}.configure(0.5); ${namespace}.initialize();`} return ${callWith(`${inputName}, undefined, "benchmark"`)} / ${namespace}.${site.unit};`);
    rightExpectedExpression = `${invoke("b", `${argument}, 0.5, "benchmark"`)} / b.${site.unit}`;
  } else if (id === "SS-3") {
    const write = numeric.body!.statements.find((statement) => ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) && ts.isPropertyAccessExpression(statement.expression.expression) && statement.expression.expression.name.text === "splice") as ts.ExpressionStatement;
    add(leftEdits, site.file, write, `history.push(${firstParameter});`);
    leftExpression = `(p.reset(), ${invoke("p")}, ${invoke("p")}, p.historySize())`; leftExpectedExpression = "2";
    body(`${namespace}.reset(); ${originalCall}; ${safe ? `if (${namespace}.historySize() === 0) ` : ""}${originalCall}; return ${namespace}.historySize();`);
    rightExpectedExpression = "1";
  } else if (id === "EB-1") {
    const guard = numeric.body!.statements.find(ts.isIfStatement)!;
    add(leftEdits, site.file, guard.thenStatement, "return undefined;");
    add(leftEdits, site.file, numeric.type!, "number | undefined");
    const alias = source.statements.filter(ts.isVariableStatement).flatMap((statement) => statement.declarationList.declarations).find((declaration) => declaration.initializer?.getText(source) === numericName)!;
    add(leftEdits, site.file, alias.initializer!, `(${numeric.parameters.map((parameter) => parameter.getText(source)).join(", ")}) => { const value = ${numericName}(${numeric.parameters.map((parameter) => parameter.name.getText(source)).join(", ")}); if (value === undefined) throw new RangeError("input"); return value; }`);
    leftExpression = invoke("p", '-1, 0.1, "benchmark"'); leftExpectedExpression = "undefined";
    body(`try { const value = ${callWith('-1, 0.1, "benchmark"', `${namespace}.${numericName}`)}; return ${safe ? `value ?? ${inputName}` : "value"}; } catch { return ${inputName}; }`);
    if (consumer.type) add(rightEdits, site.consumerFile, consumer.type, "number | undefined");
    rightExpectedExpression = String(argument);
  } else if (id === "EB-2") {
    insert(leftEdits, site.file, numeric.getStart(source) + "export ".length, "async ");
    add(leftEdits, site.file, numeric.type!, "Promise<number>");
    const alias = source.statements.filter(ts.isVariableStatement).flatMap((statement) => statement.declarationList.declarations).find((declaration) => declaration.initializer?.getText(source) === numericName)!;
    add(leftEdits, site.file, alias.initializer!, `(${numeric.parameters.map((parameter) => parameter.getText(source)).join(", ")}) => ${numeric.body!.getText(source)}`);
    leftExpression = `${invoke("p")} instanceof Promise`; leftExpectedExpression = "true";
    if (safe) {
      insert(rightEdits, site.consumerFile, consumer.getStart(consumerSource) + "export ".length, "async ");
      add(rightEdits, site.consumerFile, consumer.type!, "Promise<number>");
    }
    body(`return (${safe ? "await " : ""}${callWith(`${inputName}, 0.1, "benchmark"`, `${namespace}.${numericName}`)}) / ${namespace}.${site.unit} + ${delta};`);
    rightExpectedExpression = `await d.${consumerName}(${argument}) + ${delta}`;
  } else if (id === "SF-1") {
    insert(leftEdits, site.file, numeric.body!.getStart(source) + 1, '\n  console.log("policy evaluated");');
    body(`const value = ${callerExpression}; return value;`);
  } else if (id === "SF-2") {
    insert(leftEdits, site.file, numeric.body!.getStart(source) + 1, "\n  /* 保留当前业务规则。 */");
    body(`const value = ${callerExpression}; return value;`);
  } else if (id === "SF-3") {
    add(leftEdits, site.file, numericReturn, `const result = ${numericReturn.expression!.getText(source)}; return result;`);
    body(`const value = ${callerExpression}; return value;`);
  } else if (id === "SF-4") {
    add(leftEdits, site.file, numericReturn, `const result = ${numericReturn.expression!.getText(source)}; return result;`);
    const unrelated = source.statements.filter(ts.isFunctionDeclaration).find((statement) => statement.name?.text.startsWith("normalize"))!;
    add(rightEdits, site.file, directReturn(unrelated).expression!, `(${directReturn(unrelated).expression!.getText(source)}) + ${delta}`);
    rightExpression = `c.${unrelated.name!.text}(${argument})`;
    rightExpectedExpression = `b.${unrelated.name!.text}(${argument}) + ${delta}`;
    site.consumerFile = site.file; site.consumer = unrelated;
  } else throw new Error(`未知算子：${id}`);

  if (unrelated) {
    rightEdits.clear();
    const independent = source.statements.filter(ts.isFunctionDeclaration).find((statement) => statement.name?.text.startsWith("normalize"))!;
    add(rightEdits, site.file, directReturn(independent).expression!, `(${directReturn(independent).expression!.getText(source)}) + ${delta}`);
    site.consumerFile = site.file; site.consumer = independent;
    rightExpression = `c.${independent.name!.text}(${argument})`;
    rightExpectedExpression = `b.${independent.name!.text}(${argument}) + ${delta}`;
    rightExpected = undefined; observation = undefined;
  }

  const changed = (edits: Map<string, TextEdit[]>) => Object.fromEntries([...edits].map(([file, values]) => [file, applyEdits(project.files[file]!, values)]));
  const left = changed(leftEdits); const right = changed(rightEdits);
  const combined = new Map<string, TextEdit[]>();
  for (const side of [leftEdits, rightEdits]) for (const [file, edits] of side) combined.set(file, [...(combined.get(file) ?? []), ...edits]);
  const merged = { ...project.files, ...changed(combined) };
  const probes: BenchProbe[] = [
    { id: "left-intent", owner: "origin-intent", expression: leftExpression, expectedExpression: leftExpectedExpression, statement: "改动方声明的新行为成立。" },
    { id: "right-intent", owner: "candidate-intent", expression: rightExpression, ...(rightExpected === undefined ? { expectedExpression: rightExpectedExpression } : { expected: rightExpected }), statement: "依赖方声明的业务行为成立。" },
    { id: "policy-regression", owner: "shared-regression", expression: `Number.isFinite(Number(await p.evaluate(${sample})))`, expected: true, statement: "正常业务输入仍可计算。" },
    ...(observation ? [observation] : [])
  ];
  return { baseline: { ...project.files }, left, right, merged, probes, entryPoints: { producer: site.file, consumer: site.consumerFile }, site: { producerKey: `${site.file}#${producerName}`, consumerKey: `${site.consumerFile}#${site.consumer.name!.text}`, producerName, consumerName: site.consumer.name!.text } };
}

const siteCache = new WeakMap<SeedProject, Map<string, Site[]>>();
function findSite(project: SeedProject, objectResult: boolean, sameFile: boolean, salt: number): Site {
  const cacheKey = `${objectResult}:${sameFile}`;
  const cached = siteCache.get(project)?.get(cacheKey);
  if (cached) return { ...cached[salt % cached.length]! };
  const sourceFiles = new Map(Object.entries(project.files).filter(([file]) => file.endsWith(".ts") && !file.startsWith("test/")).map(([file, text]) => [file, ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)]));
  const index = createSemanticIndex({ files: { listFiles: () => [...sourceFiles.keys()], readFile: (file) => project.files[file]!, version: () => 0 }, now: () => 0 }); index.update();
  const sites: Site[] = [];
  for (const [file, source] of sourceFiles) {
    const functions = source.statements.filter(ts.isFunctionDeclaration).filter((node) => node.name && node.body && node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
    const numeric = functions.find((node) => node.parameters.length === 3 && node.type?.kind === ts.SyntaxKind.NumberKeyword && node.parameters[1]!.initializer && node.parameters[2]!.questionToken);
    if (!numeric) continue;
    const producer = objectResult ? functions.find((node) => node.parameters.length === 3 && ts.isObjectLiteralExpression(directReturn(node).expression!)) : numeric;
    if (!producer) continue;
    const unit = source.statements.filter(ts.isVariableStatement).filter((node) => node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)).flatMap((node) => node.declarationList.declarations).find((node) => node.initializer && ts.isNumericLiteral(node.initializer) && node.initializer.text === "1");
    if (!unit) continue;
    for (const [consumerFile, consumerSource] of sourceFiles) for (const consumer of consumerSource.statements.filter(ts.isFunctionDeclaration)) {
      if (!consumer.name || !consumer.body || !consumer.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
      if (sameFile ? consumerFile !== file || consumer.parameters.length !== 3 || !ts.isObjectLiteralExpression(directReturn(consumer).expression!) : consumerFile === file || consumer.parameters.length !== 1 || consumer.type?.kind !== ts.SyntaxKind.NumberKeyword) continue;
      if (index.findPaths([`${consumerFile}#${consumer.name.text}`], [`${file}#${producer.name!.text}`], 2).length === 0) continue;
      const calls: ts.CallExpression[] = []; const visit = (node: ts.Node) => { if (ts.isCallExpression(node)) calls.push(node); ts.forEachChild(node, visit); }; visit(consumer.body);
      const call = calls.find((node) => node.arguments.length === 3 && (ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text === (objectResult ? producer.name!.text : "evaluate") : node.expression.getText(consumerSource) === "evaluate"));
      if (!call) continue;
      const namespace = ts.isPropertyAccessExpression(call.expression) ? call.expression.expression.getText(consumerSource) : "";
      sites.push({ file, source, producer, consumerFile, consumerSource, consumer, call, namespace, numeric, unit: unit.name.getText(source) });
    }
  }
  if (!sites.length) throw new Error(`种子项目不满足算子前提：${project.name} ${objectResult ? "返回对象" : "数值函数"}`);
  sites.sort((left, right) => `${left.file}#${left.producer.name!.text}:${left.consumer.name!.text}`.localeCompare(`${right.file}#${right.producer.name!.text}:${right.consumer.name!.text}`));
  const cache = siteCache.get(project) ?? new Map(); cache.set(cacheKey, sites); siteCache.set(project, cache);
  return { ...sites[salt % sites.length]! };
}

function directReturn(node: ts.FunctionDeclaration): ts.ReturnStatement {
  const statement = node.body?.statements.find(ts.isReturnStatement);
  if (!statement?.expression) throw new Error(`声明缺少直接返回值：${node.name?.text}`);
  return statement;
}

function applyEdits(source: string, edits: TextEdit[]): string {
  const ordered = [...edits].sort((left, right) => right.start - left.start || right.end - left.end);
  for (let index = 1; index < ordered.length; index += 1) if (ordered[index]!.end > ordered[index - 1]!.start) throw new Error("算子的编辑范围重叠");
  return ordered.reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), source);
}
