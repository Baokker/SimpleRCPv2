import * as ts from "typescript";
import { createSemanticIndex } from "../semantic/index.js";
import type { BenchProbe, SeedProject } from "./types.js";
import type { OperatorTemplate } from "./templates.js";

interface Site {
  file: string; source: ts.SourceFile; producer: ts.FunctionDeclaration; returned: ts.ReturnStatement;
  consumerFile: string; consumerSource: ts.SourceFile; consumer: ts.FunctionDeclaration; call: ts.CallExpression;
  unit?: ts.VariableDeclaration; alias?: ts.VariableDeclaration;
}
interface Edit { start: number; end: number; text: string }
const cache = new WeakMap<SeedProject, Site[]>();
const indexes = new WeakMap<SeedProject, ReturnType<typeof createSemanticIndex>>();

function sites(project: SeedProject) {
  const cached = cache.get(project); if (cached) return cached;
  const sources = new Map(Object.entries(project.files).filter(([file]) => /\.ts$/.test(file) && !file.startsWith("test/")).map(([file, text]) => [file, ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)]));
  const index = createSemanticIndex({ files: { listFiles: () => [...sources.keys()], readFile: (file) => project.files[file]!, version: () => 0 }, now: () => 0 }); index.update();
  indexes.set(project, index);
  const result: Site[] = [];
  for (const [file, source] of sources) for (const producer of source.statements.filter(ts.isFunctionDeclaration)) {
    if (!producer.name || !producer.body || !producer.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) || producer.parameters[0]?.type?.kind !== ts.SyntaxKind.NumberKeyword) continue;
    const returned = producer.body.statements.find(ts.isReturnStatement);
    if (!returned?.expression) continue;
    const declarations = source.statements.filter(ts.isVariableStatement).flatMap((statement) => statement.declarationList.declarations);
    const unit = declarations.find((declaration) => declaration.initializer && ts.isNumericLiteral(declaration.initializer) && declaration.initializer.text === "1" && returned.expression!.getText(source).includes(declaration.name.getText(source)));
    const alias = declarations.find((declaration) => declaration.initializer?.getText(source) === producer.name!.text);
    const targets = new Set([`${file}#${producer.name.text}`, ...(alias ? [`${file}#${alias.name.getText(source)}`] : [])]);
    for (const [consumerFile, consumerSource] of sources) for (const consumer of consumerSource.statements.filter(ts.isFunctionDeclaration)) {
      if (!consumer.name || !consumer.body || consumer === producer || consumer.parameters.length !== 1 || consumer.parameters[0]?.type?.kind !== ts.SyntaxKind.NumberKeyword || consumer.type?.kind !== ts.SyntaxKind.NumberKeyword || !consumer.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node)) {
          const reference = ts.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression;
          if (index.referenceTargets?.(consumerFile, reference.getStart()).some((key) => targets.has(key))) result.push({ file, source, producer, returned, consumerFile, consumerSource, consumer, call: node, unit, alias });
        }
        ts.forEachChild(node, visit);
      };
      visit(consumer.body);
    }
  }
  result.sort((a, b) => `${a.file}#${a.producer.name!.text}:${a.consumerFile}#${a.consumer.name!.text}`.localeCompare(`${b.file}#${b.producer.name!.text}:${b.consumerFile}#${b.consumer.name!.text}`));
  cache.set(project, result); return result;
}

function eligible(site: Site, id: string) {
  if (["IC-3", "SF-5"].includes(id)) return Boolean(site.unit);
  if (id === "IC-1") return site.producer.parameters.some((parameter) => parameter.questionToken) && site.call.arguments.length === site.producer.parameters.length;
  if (id === "IC-4" || id === "EB-2") return Boolean(site.alias) && site.call.expression.getText(site.consumerSource).endsWith(site.alias!.name.getText(site.source)) && site.producer.type?.kind === ts.SyntaxKind.NumberKeyword;
  if (id === "CP-2") return site.producer.parameters[1]?.initializer && ts.isNumericLiteral(site.producer.parameters[1].initializer);
  if (id === "CP-3") return site.producer.type?.kind === ts.SyntaxKind.NumberKeyword;
  if (id === "CP-5") return site.file === site.consumerFile && Boolean(site.unit);
  if (id === "SS-1" || id === "IC-2") return ts.isObjectLiteralExpression(site.returned.expression!) && site.returned.expression.properties.length >= 2 && ts.isPropertyAccessExpression(site.call.parent);
  return ["SF-1", "SF-2", "SF-3", "SF-4"].includes(id);
}

export function nativeOperatorIds(project: SeedProject, ids: string[]) { return ids.filter((id) => sites(project).some((site) => eligible(site, id))); }

export function nativeOperatorTemplate(id: string, safe: boolean, salt: number, project: SeedProject, unrelated: boolean): OperatorTemplate {
  const available = sites(project).filter((site) => eligible(site, id));
  const selected = available[salt % available.length];
  const site = selected && { ...selected };
  if (!site) throw new Error(`项目没有满足 ${id} 前提的符号与调用点：${project.name}`);
  const left = new Map<string, Edit[]>(); const right = new Map<string, Edit[]>();
  const edit = (side: Map<string, Edit[]>, file: string, node: ts.Node, text: string) => { const edits = side.get(file) ?? []; edits.push({ start: node.getStart(), end: node.end, text }); side.set(file, edits); };
  const insert = (side: Map<string, Edit[]>, file: string, start: number, text: string) => { const edits = side.get(file) ?? []; edits.push({ start, end: start, text }); side.set(file, edits); };
  const producer = site.producer.name!.text; const consumer = site.consumer.name!.text;
  const preserveCallers = (replacement: string, onlyProperty?: string) => {
    const index = indexes.get(project)!;
    for (const [file, text] of Object.entries(project.files).filter(([file]) => file.endsWith(".ts"))) {
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      let needsImport = false;
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node)) {
          const reference = ts.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression;
          if (index.referenceTargets?.(file, reference.getStart()).includes(`${site.file}#${producer}`) && (!onlyProperty || ts.isPropertyAccessExpression(node.parent) && node.parent.name.text === onlyProperty)) {
            edit(left, file, reference, replacement);
            if (file !== site.file && ts.isIdentifier(node.expression)) needsImport = true;
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      if (needsImport) {
        const declaration = source.statements.filter(ts.isImportDeclaration).find((node) => node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings) && node.importClause.namedBindings.elements.some((item) => (item.propertyName ?? item.name).text === producer));
        const bindings = declaration?.importClause?.namedBindings;
        if (!bindings || !ts.isNamedImports(bindings)) throw new Error("业务调用点缺少可更新的 import");
        insert(left, file, bindings.end - 1, `, ${replacement} `);
      }
    }
  };
  const argument = 80 + salt % 61;
  const args = site.producer.parameters.map((parameter, index) => index === 0 ? String(argument) : parameter.type?.kind === ts.SyntaxKind.NumberKeyword ? "0.1" : '"standard"');
  const invoke = (prefix: string, argumentsText = args.join(", ")) => `${prefix}.${producer}(${argumentsText})`;
  let leftExpression = invoke("p"); let expectedLeft = invoke("b");
  insert(right, site.consumerFile, site.consumer.body!.getStart() + 1, "\n  // 检查当前业务输入。\n");
  if (id === "IC-3" || id === "SF-5" || id === "CP-5") {
    edit(left, site.file, site.unit!.initializer!, "1000");
    expectedLeft = `(${invoke("b")}) * 1000`;
    if (!safe && id !== "SF-5") {
      const replace = (node: ts.Node) => {
        if ((ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) && node.getText(site.consumerSource).endsWith(site.unit!.name.getText(site.source)) && (!ts.isIdentifier(node) || !ts.isPropertyAccessExpression(node.parent))) edit(right, site.consumerFile, node, "1");
        else ts.forEachChild(node, replace);
      };
      replace(site.consumer.body!);
    }
  } else if (id === "CP-2") {
    edit(left, site.file, site.producer.parameters[1]!.initializer!, "0.25");
    leftExpression = invoke("p", [args[0], "undefined", ...args.slice(2)].join(", "));
    expectedLeft = invoke("b", [args[0], "0.25", ...args.slice(2)].join(", "));
    if (!safe && site.call.arguments[1]) edit(right, site.consumerFile, site.call.arguments[1], "undefined");
  } else if (id === "CP-3") {
    insert(left, site.file, site.producer.body!.getStart() + 1, `\n  if (${site.producer.parameters[0]!.name.getText(site.source)} === 0) throw new RangeError("zero input");`);
    leftExpression = `(() => { try { ${invoke("p", ["0", ...args.slice(1)].join(", "))}; return false; } catch { return true; } })()`; expectedLeft = "true";
    edit(right, site.consumerFile, site.call.arguments[0]!, safe ? `Math.max(1, ${site.call.arguments[0]!.getText(site.consumerSource)})` : "0");
  } else if (id === "IC-1") {
    const position = site.producer.parameters.findIndex((parameter) => parameter.questionToken);
    const parameter = site.producer.parameters[position]!;
    edit(left, site.file, parameter.questionToken!, "");
    insert(left, site.file, site.producer.body!.getStart() + 1, `\n  if (${parameter.name.getText(site.source)} === undefined) throw new Error("required context");`);
    if (!safe) edit(right, site.consumerFile, site.call, `${site.call.expression.getText(site.consumerSource)}(${site.call.arguments.slice(0, position).map((value) => value.getText(site.consumerSource)).join(", ")})`);
  } else if (id === "IC-4") {
    const name = `${producer}V2`;
    const index = indexes.get(project)!;
    for (const [file, text] of Object.entries(project.files).filter(([file]) => file.endsWith(".ts"))) {
      const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      const rename = (node: ts.Node) => {
        if (ts.isIdentifier(node) && index.referenceTargets?.(file, node.getStart()).includes(`${site.file}#${producer}`)) edit(left, file, node, name);
        ts.forEachChild(node, rename);
      };
      rename(tree);
    }
    if (!(left.get(site.file) ?? []).some((change) => change.start === site.producer.name!.getStart())) edit(left, site.file, site.producer.name!, name);
    leftExpression = `typeof p.${producer}`; expectedLeft = '"undefined"';
    if (!safe) edit(right, site.consumerFile, site.call.expression, ts.isPropertyAccessExpression(site.call.expression) ? `${site.call.expression.expression.getText(site.consumerSource)}.${producer}` : producer);
  } else if (id === "SS-1") {
    const returned = site.returned.expression as ts.ObjectLiteralExpression;
    const properties = returned.properties.map((property) => property.name!.getText(site.source));
    insert(left, site.file, site.producer.getStart(), `const retained${producer} = { ${properties.map((name) => `${name}: 0`).join(", ")} };\n`);
    edit(left, site.file, returned, `Object.assign(retained${producer}, ${returned.getText(site.source)})`);
    leftExpression = `${invoke("p")} === ${invoke("p", [String(argument + 1), ...args.slice(1)].join(", "))}`; expectedLeft = "true";
    const call = site.call.getText(site.consumerSource);
    insert(right, site.consumerFile, site.consumer.body!.getStart() + 1, `\n  const retainedResult = ${safe ? `{ ...${call} }` : call};\n  ${site.call.expression.getText(site.consumerSource)}(${[`${site.call.arguments[0]!.getText(site.consumerSource)} + 1`, ...site.call.arguments.slice(1).map((node) => node.getText(site.consumerSource))].join(", ")});\n`);
    edit(right, site.consumerFile, site.call, "retainedResult");
  } else if (id === "IC-2") {
    const returned = site.returned.expression as ts.ObjectLiteralExpression;
    const used = (site.call.parent as ts.PropertyAccessExpression).name.text;
    const removed = returned.properties.find((property) => property.name?.getText(site.source) !== used)!;
    const removedName = removed.name!.getText(site.source);
    const compatible = `${producer}Compatible`;
    insert(left, site.file, site.producer.getStart(), `${site.producer.getText(site.source).replace(`function ${producer}`, `function ${compatible}`)}\n`);
    preserveCallers(compatible, removedName);
    edit(left, site.file, returned, `{ ${returned.properties.filter((property) => property !== removed).map((property) => property.getText(site.source)).join(", ")} }`);
    leftExpression = `Object.hasOwn(${invoke("p")}, ${JSON.stringify(removedName)})`; expectedLeft = "false";
    if (!safe) edit(right, site.consumerFile, (site.call.parent as ts.PropertyAccessExpression).name, removedName);
  } else if (id === "EB-2") {
    preserveCallers(site.alias!.name.getText(site.source));
    insert(left, site.file, site.producer.getStart() + "export ".length, "async ");
    edit(left, site.file, site.producer.type!, "Promise<number>");
    edit(left, site.file, site.alias!.initializer!, `(${site.producer.parameters.map((parameter) => parameter.getText(site.source)).join(", ")}) => ${site.producer.body!.getText(site.source)}`);
    leftExpression = `${invoke("p")} instanceof Promise`; expectedLeft = "true";
    edit(right, site.consumerFile, site.call.expression, ts.isPropertyAccessExpression(site.call.expression) ? `${site.call.expression.expression.getText(site.consumerSource)}.${producer}` : producer);
    if (safe) { insert(right, site.consumerFile, site.consumer.getStart() + "export ".length, "async "); edit(right, site.consumerFile, site.consumer.type!, "Promise<number>"); edit(right, site.consumerFile, site.call, `(await ${site.call.expression.getText(site.consumerSource).replace(site.alias!.name.getText(site.source), producer)}(${site.call.arguments.map((node) => node.getText(site.consumerSource)).join(", ")}))`); right.get(site.consumerFile)!.splice(right.get(site.consumerFile)!.findIndex((value) => value.start === site.call.expression.getStart()), 1); }
  } else if (id === "SF-1" || id === "SF-2") {
    insert(left, site.file, site.producer.body!.getStart() + 1, id === "SF-1" ? '\n  console.log("business input", arguments[0]);' : "\n  // 使用当前业务规则。\n");
  } else {
    edit(left, site.file, site.returned, `const computedResult = ${site.returned.expression!.getText(site.source)}; return computedResult;`);
  }
  let rightConsumer = consumer;
  let rightExpression = `await c.${rightConsumer}(${argument})`;
  let expectedRight = `await d.${rightConsumer}(${argument})`;
  let regressionExpression = `Number.isFinite(await c.${rightConsumer}(${argument + 7}))`;
  if (unrelated || id === "SF-4") {
    right.clear();
    const index = indexes.get(project)!;
    const independent = Object.entries(project.files).filter(([file]) => file.endsWith(".ts") && !file.startsWith("test/") && file !== site.file).flatMap(([file, text]) => {
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      return source.statements.filter(ts.isFunctionDeclaration).filter((node) => node.body && node.name && node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)).map((node) => ({ file, node }));
    }).find(({ file, node }) => !index.findPaths([`${site.file}#${producer}`], [`${file}#${node.name!.text}`], 2).length);
    if (!independent) throw new Error(`项目没有无关业务函数：${project.name}`);
    insert(right, independent.file, independent.node.body!.getStart() + 1, "\n  // 检查独立业务输入。\n");
    regressionExpression = `Number.isFinite(await (await import(${JSON.stringify(`./${site.consumerFile}`)})).${consumer}(${argument + 7}))`;
    site.consumerFile = independent.file; rightConsumer = independent.node.name!.text;
    rightExpression = `typeof c.${rightConsumer}`; expectedRight = '"function"';
  }
  const apply = (edits: Map<string, Edit[]>) => Object.fromEntries([...edits].map(([file, changes]) => {
    const ordered = [...changes].sort((a, b) => b.start - a.start || b.end - a.end);
    for (let index = 1; index < ordered.length; index += 1) if (ordered[index]!.end > ordered[index - 1]!.start) throw new Error("算子的编辑范围重叠");
    return [file, ordered.reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), project.files[file]!)];
  }));
  const leftFiles = apply(left); const rightFiles = apply(right);
  const both = new Map([...left].map(([file, edits]) => [file, [...edits]]));
  for (const [file, edits] of right) both.set(file, [...(both.get(file) ?? []), ...edits]);
  const probes: BenchProbe[] = [{ id: "left-intent", owner: "origin-intent", expression: leftExpression, expectedExpression: expectedLeft, statement: "改动方的新行为成立。" }, { id: "right-intent", owner: "candidate-intent", expression: rightExpression, expectedExpression: expectedRight, statement: "调用方保持声明的业务结果。" }, { id: "shared-regression", owner: "shared-regression", expression: regressionExpression, expected: true, statement: "调用方处理另一个有效业务输入并返回有限数值；种子项目的全部测试同时执行。" }];
  return { baseline: { ...project.files }, left: leftFiles, right: rightFiles, merged: { ...project.files, ...apply(both) }, probes, reference: { ...project.files, ...rightFiles }, entryPoints: { producer: site.file, consumer: site.consumerFile }, site: { producerKey: `${site.file}#${producer}`, consumerKey: `${site.consumerFile}#${rightConsumer}`, producerName: producer, consumerName: rightConsumer } };
}
