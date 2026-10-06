import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { inspectSeedDiversity, nativeOperatorIds, OPERATOR_SPECS } from "../dist/bench/index.js";
import { readSeedProjects } from "./seed-projects.ts";

const { values } = parseArgs({ options: { seeds: { type: "string", default: "bench/seeds/native" }, out: { type: "string" } } });
const projects = await readSeedProjects(path.resolve(values.seeds!));
const diversity = inspectSeedDiversity(projects);
const result = { diversity, operators: projects.map((project) => ({ project: project.name, eligible: nativeOperatorIds(project, OPERATOR_SPECS.map((operator) => operator.id)) })) };
if (values.out) await fs.writeFile(path.resolve(values.out), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ valid: diversity.valid, sizes: diversity.sizes, maximumObserved: diversity.maximumObserved, violations: diversity.violations.slice(0, 12), operators: result.operators }));
process.exitCode = diversity.valid ? 0 : 1;
