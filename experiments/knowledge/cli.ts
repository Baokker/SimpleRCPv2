import path from "node:path";
import {parseArgs} from "node:util";
import {configSchema, dataset, readJson, root, platformRoot, RunStore, writeJson, readJsonl, digest, exists, selectIds} from "./common.js";
import {allK3Conditions, runK3, calibration, type K3Condition} from "./k3.js";
import {allK4Conditions, runK4, type K4Condition} from "./k4.js";
import {runK1Offline, runK1Online, compareK1Recordings} from "./k1.js";
import {runK2} from "./k2.js";
import {runK5} from "./k5.js";
import {runK7} from "./k7.js";
import {judge} from "./client.js";

const {values, positionals} = parseArgs({allowPositionals: true, options: {
  config: {type: "string"}, out: {type: "string"}, tasks: {type: "string"}, conditions: {type: "string"}, pairs: {type: "string"},
  pilot: {type: "boolean", default: false}, online: {type: "boolean", default: false}, calibration: {type: "boolean", default: false},
  source: {type: "string"}, limit: {type: "string"}, variants: {type: "string"}, workspace: {type: "string"}
}});
const command = positionals[0];
if (!["verify", "k1", "k1-compare", "k2", "k3", "k4", "k5", "k7", "judge-stability", "summarize"].includes(command)) throw new Error("Command: verify|k1|k1-compare|k2|k3|k4|k5|k7|judge-stability|summarize");
const resolveInput = (file: string) => path.resolve(platformRoot, file);
const config = configSchema.parse(values.config ? await readJson(resolveInput(values.config)) : {});
const data = await dataset();
if (values.limit && (!Number.isSafeInteger(Number(values.limit)) || Number(values.limit) <= 0)) throw new Error("--limit must be a positive integer");
if (command === "verify") {
  console.log(JSON.stringify({manifestHash: data.manifestHash, filesChecked: data.filesChecked, traps: data.tasks.filter(task => task.kind === "trap").length,
    controls: data.tasks.filter(task => task.kind === "control").length, transfers: data.transfers.length, model: config.model, provider: config.provider}));
} else if (command === "summarize") {
  if (!values.source) throw new Error("--source is required");
  const rows = await readJsonl(path.join(resolveInput(values.source), "results.jsonl"));
  const groups = [...new Set(rows.map(row => row.condition))].map(condition => {
    const selected = rows.filter(row => row.condition === condition);
    const mean = (field: string) => {const valid = selected.filter(row => row[field] !== null && row[field] !== undefined); return valid.length ? valid.reduce((sum, row) => sum + Number(row[field]), 0) / valid.length : null;};
    return {condition, combinations: selected.length, functional: mean("functional"), trapAvoided: mean("trapAvoided"), jointSuccess: mean("jointSuccess"), recall1: mean("recall1"), recall3: mean("recall3"), recall5: mean("recall5"), mrr: mean("mrr"), ndcg5: mean("ndcg5")};
  });
  await writeJson(path.join(resolveInput(values.source), "summary.json"), groups); console.log(JSON.stringify(groups));
} else {
  const directory = values.out ? resolveInput(values.out) : path.join(root, "runs", `${command}-${new Date().toISOString().replace(/[:.]/gu, "-")}`);
  const store = await new RunStore(directory).open(command, config, data);
  try {
    if (values.source) {
      const source = resolveInput(values.source);
      const input = {source, resultsHash: digest(await readJsonl(path.join(source, "results.jsonl")))};
      const saved = path.join(directory, "source.json");
      if (await exists(saved) && digest(await readJson(saved)) !== digest(input)) throw new Error("Source experiment changed during resume");
      await writeJson(saved, input);
      store.metadata.sourceResultsHash = input.resultsHash;
    } else if (await exists(path.join(directory, "source.json"))) throw new Error("Resume requires the original --source");
    if (command === "k1") {await runK1Offline(store); if (values.online) await runK1Online(data, config, store);}
    if (command === "k1-compare") {
      if (!values.source) throw new Error("--source is required");
      await compareK1Recordings(config, store, resolveInput(values.source));
    }
    if (command === "k2") await runK2(data, config, store, values.source && resolveInput(values.source), values.limit ? Number(values.limit) : undefined);
    if (command === "k3") {
      let tasks = values.tasks ? selectIds(data.tasks, values.tasks) : data.tasks;
      if (values.pilot && !values.tasks) tasks = ["R1-T01", "R1-T02", "R2-T01", "R2-T02", "R1-C01"].map(id => data.tasks.find(task => task.id === id)!);
      const conditions = (values.conditions?.split(",") ?? (values.pilot ? ["C0", "C2"] : allK3Conditions)) as K3Condition[];
      if (new Set(conditions).size !== conditions.length || conditions.some(condition => !allK3Conditions.includes(condition))) throw new Error("Invalid K3 conditions");
      const combinations = tasks.flatMap(task => conditions.flatMap(condition => Array.from({length: values.pilot ? 1 : config.repetitions}, (_, index) => ({task, condition, repetition: index + 1}))));
      if (values.calibration) for (const task of data.tasks.filter(task => task.kind === "trap")) for (let repetition = 1; repetition <= 3; repetition++) {
        if (!combinations.some(item => item.task.id === task.id && item.condition === "C0" && item.repetition === repetition)) combinations.push({task, condition: "C0", repetition});
      }
      await runK3(data, config, store, combinations); if (values.calibration) console.log(JSON.stringify(await calibration(store)));
    }
    if (command === "k4") {
      const pairs = values.pairs ? selectIds(data.transfers, values.pairs) : data.transfers.filter(pair => values.pilot ? ["P01", "P03"].includes(pair.id) : true);
      const conditions = (values.conditions?.split(",") ?? (values.pilot ? ["T0", "T3"] : allK4Conditions)) as K4Condition[];
      if (new Set(conditions).size !== conditions.length || conditions.some(condition => !allK4Conditions.includes(condition))) throw new Error("Invalid K4 conditions");
      const variants = values.variants?.split(",") ?? (values.pilot ? ["delayed"] : ["delayed", "same-session"]);
      if (new Set(variants).size !== variants.length || variants.some(variant => !["delayed", "same-session"].includes(variant))) throw new Error("Invalid K4 variants");
      await runK4(data, config, store, pairs.flatMap(pair => conditions.flatMap(condition => variants.flatMap(variant => Array.from({length: values.pilot ? 1 : config.repetitions}, (_, index) => ({pair, condition, variant: variant as "delayed" | "same-session", repetition: index + 1}))))));
    }
    if (command === "k5") await runK5(data, config, store, values.source && resolveInput(values.source));
    if (command === "k7") await runK7(config, store);
    if (command === "judge-stability") {
      const task = data.tasks.find(task => task.id === values.tasks);
      if (!task || !values.workspace) throw new Error("--tasks and --workspace are required");
      const first = await judge(task, resolveInput(values.workspace), store.raw("first"));
      const second = await judge(task, resolveInput(values.workspace), store.raw("second"));
      const outcome = (row: any) => ({functional: row.functional, trapAvoided: row.trapAvoided, jointSuccess: row.jointSuccess,
        tests: Object.fromEntries(Object.entries(row.tests).map(([name, value]) => {const test = value as any; return [name, {status: test.status, passed: test.passed, failed: test.failed, signal: test.signal}];})),
        trapEvidence: {status: row.trapEvidence.status, parsed: row.trapEvidence.parsed, signal: row.trapEvidence.signal}});
      const equal = JSON.stringify(outcome(first)) === JSON.stringify(outcome(second));
      await store.append({key: `${task.id}-stability`, completed: true, task: task.id, equal, first: outcome(first), second: outcome(second)});
      if (!equal) throw new Error("Judge output is not stable");
    }
    console.log(JSON.stringify({directory, complete: true}));
  } catch (error) {
    await writeJson(path.join(directory, "failure.json"), {at: new Date().toISOString(), command, message: error instanceof Error ? error.message : String(error)});
    throw error;
  } finally {await store.close();}
}
