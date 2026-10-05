import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import * as ts from "typescript";
import { labelManifest } from "../dist/bench/labeler.js";
import type { BenchManifest, BenchVariant, ProbeRun } from "../dist/bench/types.js";

const args = parseArgs(process.argv.slice(2));
const directory = path.resolve(args.dataset ?? "bench/datasets/d1-v1");
const manifest = JSON.parse(await fs.readFile(path.join(directory, "manifest.json"), "utf8")) as BenchManifest;
const probeResults = new Map<string, ProbeRun>();
for (const group of manifest.groups) for (const variant of [group.variants.conflict, group.variants.safe]) for (const state of ["baseline", "leftOnly", "rightOnly", "merged"] as const) probeResults.set(`${variant.id}:${state}`, await executeProbe(variant, state));
const result = labelManifest(manifest, (variant, state) => probeResults.get(`${variant.id}:${state}`) ?? { passed: false, observations: { missingProbe: true } });
await fs.writeFile(path.join(directory, "labels.json"), `${JSON.stringify(result.labels, null, 2)}\n`, "utf8");
await fs.writeFile(path.join(directory, "excluded.json"), `${JSON.stringify(result.excluded, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ dataset: directory, labels: result.labels.length, excluded: result.excluded.length, concurrency: Number(args.concurrency ?? 1) }));

async function executeProbe(variant: BenchVariant, state: "baseline" | "leftOnly" | "rightOnly" | "merged"): Promise<ProbeRun> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "simplercp-probe-"));
  try {
    const sources = variant[state];
    for (const [file, source] of Object.entries(sources)) {
      const output = file.replace(/\.(?:mts|cts|tsx|ts|jsx|js)$/i, ".js");
      await fs.mkdir(path.dirname(path.join(root, output)), { recursive: true });
      const transpiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
      await fs.writeFile(path.join(root, file), source, "utf8");
      await fs.writeFile(path.join(root, output), transpiled, "utf8");
    }
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ type: "module" }), "utf8");
    const typeError = state === "merged" && hasTypeError(root, Object.keys(sources).filter((file) => /\.(?:ts|tsx|mts|cts)$/i.test(file)));
    if (typeError) return { passed: false, observations: { typeError: true }, typeError: true };
    const probe = path.join(root, "probe.mjs");
    await fs.writeFile(probe, "import { checkout } from './src/consumer.js';\nconst value = checkout(100);\nif (typeof value !== 'number' || !Number.isFinite(value)) process.exit(2);\nconsole.log(JSON.stringify({ value }));\n", "utf8");
    const result = await runNode(probe, root);
    if (result.code !== 0) return { passed: false, observations: { exitCode: result.code }, typeError: variant.detectability === "typecheck" };
    const outputLine = result.stdout.trim().split("\n").at(-1) ?? "{}";
    const observation = JSON.parse(outputLine) as { value?: number };
    return { passed: true, observations: { value: observation.value ?? "undefined" } };
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function hasTypeError(root: string, files: string[]) {
  const program = ts.createProgram(files.map((file) => path.join(root, file)), { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, noEmit: true, skipLibCheck: true, lib: ["lib.es2022.d.ts"] });
  return ts.getPreEmitDiagnostics(program).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
}

function runNode(file: string, cwd: string) {
  return new Promise<{ code: number; stdout: string }>((resolve) => {
    execFile(process.execPath, [file], { cwd }, (error, stdout) => resolve({ code: error && typeof error.code === "number" ? error.code : error ? 1 : 0, stdout: String(stdout) }));
  });
}

function parseArgs(argv: string[]) {
  const result: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) if (argv[index]?.startsWith("--")) result[argv[index]!.slice(2)] = argv[index + 1] ?? "";
  return result;
}
