import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as ts from "typescript";

const root = process.cwd();
const input = JSON.parse(await fs.readFile(path.join(root, "state.json"), "utf8")) as Record<string, string>;
for (const [file, source] of Object.entries(input)) {
  const target = path.resolve(root, file);
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error("探针文件路径越过工作目录");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, source);
  await fs.writeFile(target.replace(/\.(?:mts|cts|tsx|ts|jsx|js)$/i, ".js"), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
}
const program = ts.createProgram(Object.keys(input).filter((file) => /\.(?:ts|tsx|mts|cts)$/.test(file)).map((file) => path.join(root, file)), {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  noEmit: true, allowImportingTsExtensions: true, skipLibCheck: true, types: [], lib: ["lib.es2022.d.ts", "lib.dom.d.ts"]
});
const diagnostics = ts.getPreEmitDiagnostics(program).filter((item) => item.category === ts.DiagnosticCategory.Error).map((item) => `${item.code}: ${ts.flattenDiagnosticMessageText(item.messageText, " ")}`);
const { result } = await import(pathToFileURL(path.join(root, "probe.mjs")).href);
console.log(JSON.stringify({ ...result, typeError: diagnostics.length > 0, diagnostics }));
