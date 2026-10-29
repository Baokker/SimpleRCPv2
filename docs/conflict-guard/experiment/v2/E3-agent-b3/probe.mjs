import path from "node:path"; import { pathToFileURL } from "node:url";
const [ws, kind] = process.argv.slice(2);
const load = (f) => import(pathToFileURL(path.join(ws, "src", f + ".ts")).href);
const safe = (fn) => { try { return JSON.stringify(fn()); } catch (e) { return "ERR:" + e.message.slice(0, 40); } };
if (kind === "quote") { const p = await load("pricing"), c = await load("cart"); const q = p.quote(100, 0.1, "CNY");
  console.log(JSON.stringify({ keys: Object.keys(q), invoiceNet: safe(() => c.invoiceNet(100)), grossLabel: typeof c.grossLabel === "function" ? safe(() => c.grossLabel(100)) : "missing" })); }
else { const r = await load("retry"), d = await load("delivery");
  console.log(JSON.stringify({ retryDelay: r.retryDelay(1, 2, "standard"), estimatedWait: safe(() => d.estimatedWait(1)), waitLabel: typeof d.waitLabel === "function" ? safe(() => d.waitLabel(1)) : "missing" })); }
