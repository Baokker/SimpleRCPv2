import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import * as ts from "typescript";

const root = process.cwd();
const input = JSON.parse(await fs.readFile(path.join(root, "state.json"), "utf8")) as { files: Record<string, string>; reference: Record<string, string> };
for (const [file, source] of [...Object.entries(input.files), ...Object.entries(input.reference).map(([file, source]) => [`reference/${file}`, source] as const)]) {
  const target = path.resolve(root, file);
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error("探针文件路径越过工作目录");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, source);
  if (/\.(?:mts|cts|tsx|ts|jsx|js)$/i.test(target)) await fs.writeFile(target.replace(/\.(?:mts|cts|tsx|ts|jsx|js)$/i, ".js"), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
}
const program = ts.createProgram(Object.keys(input.files).filter((file) => /\.(?:ts|tsx|mts|cts)$/.test(file)).map((file) => path.join(root, file)), {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  noEmit: true, allowImportingTsExtensions: true, skipLibCheck: true, types: [], lib: ["lib.es2022.d.ts", "lib.dom.d.ts"]
});
const diagnostics = ts.getPreEmitDiagnostics(program).filter((item) => item.category === ts.DiagnosticCategory.Error).map((item) => `${item.code}: ${ts.flattenDiagnosticMessageText(item.messageText, " ")}`);
const { result } = await import(pathToFileURL(path.join(root, "probe.mjs")).href);
const tests = Object.keys(input.files).filter((file) => file.startsWith("test/") && /\.test\.(?:mjs|js|ts)$/.test(file)).sort();
if (!tests.length) throw new Error("种子项目缺少共享回归测试");
const regression = await new Promise<{ passed: boolean; tests: number; stdout: string; stderr: string }>((resolve) => {
  execFile(process.execPath, ["--experimental-strip-types", "--test", ...tests], { cwd: root, timeout: 12_000, maxBuffer: 1_048_576 }, (error, stdout, stderr) => resolve({ passed: !error, tests: tests.length, stdout, stderr }));
});
console.log(JSON.stringify({ ...result, passed: result.passed && regression.passed, regression, typeError: diagnostics.length > 0, diagnostics }));
