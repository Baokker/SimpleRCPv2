import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {z} from "zod";
import {isKnowledgeCard, type KnowledgeCard} from "@simplercp/knowledge";

export const root = fileURLToPath(new URL(".", import.meta.url));
export const platformRoot = path.resolve(root, "../..");
export const benchRoot = path.resolve(platformRoot, "../knowledge-bench");
export const exec = promisify(execFile);
export const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export const digest = (value: unknown) => hash(JSON.stringify(value));
export const readJson = async <T = any>(file: string): Promise<T> => JSON.parse(await fs.readFile(file, "utf8"));
export const readJsonl = async <T = any>(file: string): Promise<T[]> => (await fs.readFile(file, "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line));
export async function exists(file: string) { return fs.stat(file).then(() => true, error => {if (error.code === "ENOENT") return false; throw error;}); }
export async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), {recursive: true});
  const temporary = `${file}.${process.pid}.next`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + "\n", {mode: 0o600});
  await fs.rename(temporary, file);
}
export const configSchema = z.object({
  origin: z.string().url().default("http://127.0.0.1:4179"),
  provider: z.literal("minimax").default("minimax"),
  model: z.string().default("MiniMax-M2"),
  concurrency: z.number().int().min(1).max(8).default(1),
  timeoutMs: z.number().int().positive().default(600000),
  delayMs: z.number().int().nonnegative().default(60000),
  speed: z.number().positive().default(10),
  repetitions: z.number().int().positive().default(3),
  seed: z.number().int().default(20261007),
  embedding: z.object({origin: z.string().url(), model: z.string()}).optional()
}).strict();
export type ExperimentConfig = z.infer<typeof configSchema>;
export type Task = {
  id: string; repository: "R1" | "R2"; kind: "trap" | "control" | "transfer";
  targetCardId?: string; irrelevantCardIds?: string[]; variantCardIds?: string[];
  directory: string; prompt: string; [key: string]: any;
};
export async function dataset() {
  const manifestText = await fs.readFile(path.join(benchRoot, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestText) as Record<string, string>;
  for (const [relative, expected] of Object.entries(manifest)) {
    const file = path.join(benchRoot, relative);
    const information = await fs.lstat(file);
    const bytes = information.isSymbolicLink() ? await fs.readlink(file) : await fs.readFile(file);
    if (hash(bytes) !== expected) throw new Error(`Dataset hash mismatch: ${relative}`);
  }
  const library = await readJson<Array<{repository: string; card: KnowledgeCard}>>(path.join(benchRoot, "trapbench/cards/library.json"));
  if (library.some(item => !isKnowledgeCard(item.card))) throw new Error("Dataset card schema is invalid");
  const tasks: Task[] = [];
  for (const entry of await fs.readdir(path.join(benchRoot, "trapbench/tasks"), {withFileTypes: true})) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const directory = path.join(benchRoot, "trapbench/tasks", entry.name);
    tasks.push({...await readJson(path.join(directory, "task.json")), directory, prompt: await fs.readFile(path.join(directory, "prompt.md"), "utf8")});
  }
  const transfers = [];
  for (const id of ["P01", "P02", "P03", "P04"]) {
    const directory = path.join(benchRoot, "transfer/pairs", id);
    const pair = await readJson(path.join(directory, "pair.json"));
    const sides: Task[] = [];
    for (const side of ["ta", "tb"]) {
      const location = path.join(directory, side);
      sides.push({...await readJson(path.join(location, "task.json")), directory: location, prompt: await fs.readFile(path.join(location, "prompt.md"), "utf8")});
    }
    transfers.push({...pair, directory, ta: sides[0], tb: sides[1], correction: await readJson(path.join(directory, "correction.json")), gold: await readJson<KnowledgeCard>(path.join(directory, "gold-card.json"))});
  }
  return {manifestHash: hash(manifestText), filesChecked: Object.keys(manifest).length, library, tasks, transfers};
}
export type Dataset = Awaited<ReturnType<typeof dataset>>;

export class RunStore {
  private completed = new Set<string>();
  private queue = Promise.resolve();
  private lock: Awaited<ReturnType<typeof fs.open>> | undefined;
  metadata: Record<string, unknown> = {};
  constructor(readonly directory: string) {}
  async open(experiment: string, config: ExperimentConfig, data: Dataset) {
    await fs.mkdir(this.directory, {recursive: true});
    const lockPath = path.join(this.directory, ".runner.lock");
    if (await exists(lockPath)) {
      const pid = Number(await fs.readFile(lockPath, "utf8"));
      if (!Number.isInteger(pid) || pid < 1) throw new Error("Invalid runner lock");
      let active = true;
      try {process.kill(pid, 0);} catch (error) {if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; active = false;}
      if (active) throw new Error(`Runner is active: ${pid}`);
      await fs.unlink(lockPath);
    }
    this.lock = await fs.open(lockPath, "wx");
    await this.lock.writeFile(String(process.pid));
    const commit = (await exec("git", ["rev-parse", "HEAD"], {cwd: platformRoot})).stdout.trim();
    this.metadata = {experiment, commit, configHash: digest(config), manifestHash: data.manifestHash, provider: config.provider, model: config.model};
    const configurationPath = path.join(this.directory, "configuration.json");
    if (await exists(configurationPath)) {
      const previous = await readJson(configurationPath);
      for (const key of ["experiment", "commit", "configHash", "manifestHash", "provider", "model"]) {
        if (previous[key] !== this.metadata[key]) throw new Error(`Resume metadata changed: ${key}`);
      }
    } else await writeJson(configurationPath, {...this.metadata, config});
    const resultsPath = path.join(this.directory, "results.jsonl");
    if (await exists(resultsPath)) for (const row of await readJsonl(resultsPath)) if (row.completed) this.completed.add(row.key);
    return this;
  }
  done(key: string) { return this.completed.has(key); }
  raw(key: string) {return path.join(this.directory, "raw", key);}
  async append(row: Record<string, unknown>) {
    const result = this.queue.then(async () => {
      const file = await fs.open(path.join(this.directory, "results.jsonl"), "a", 0o600);
      try {await file.writeFile(JSON.stringify({...this.metadata, ...row}) + "\n"); await file.sync();}
      finally {await file.close();}
      if (row.completed) this.completed.add(String(row.key));
    });
    this.queue = result;
    await result;
  }
  async close() {await this.queue; await this.lock?.close(); await fs.unlink(path.join(this.directory, ".runner.lock"));}
}
export async function pool<T>(items: T[], concurrency: number, processItem: (item: T) => Promise<void>) {
  let cursor = 0;
  await Promise.all(Array.from({length: concurrency}, async () => {
    while (cursor < items.length) {const item = items[cursor++]; await processItem(item);}
  }));
}
export const pause = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
