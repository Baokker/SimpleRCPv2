import fs from "node:fs/promises";
import path from "node:path";
import {configSchema, readJson, exists, root} from "./common.js";
import {PlatformClient} from "./client.js";

const api = new PlatformClient(configSchema.parse(await readJson(path.join(root, "formal-v21.json"))));
const directory = path.resolve(process.argv[2]);
for (const entry of await fs.readdir(directory, {withFileTypes: true})) {
  if (!entry.isDirectory()) continue;
  const raw = path.join(directory, entry.name), projectFile = path.join(raw, "project.json");
  if (!await exists(projectFile)) continue;
  const {project, members} = await readJson(projectFile);
  for (const filename of ["started-run.json", "ta-started.json", "correction-run.json", "tb-started.json"]) {
    if (!await exists(path.join(raw, filename))) continue;
    const saved = await readJson(path.join(raw, filename));
    const viewer = saved.initiatorMemberId ?? saved.memberId ?? members[0];
    const {run} = await api.request(api.projectRoute(project, `agent/runs/${saved.id}`), viewer);
    if (["completed", "failed", "cancelled"].includes(run.status)) continue;
    const {events} = await api.request(api.projectRoute(project, `agent/runs/${saved.id}/trace`), viewer);
    console.log(JSON.stringify({key: entry.name, filename, id: run.id, status: run.status, phase: run.activity?.phase, elapsedMs: Date.now() - Date.parse(run.startedAt ?? run.createdAt), traceEvents: events.length, lastEvent: events.at(-1)?.type}));
  }
}
