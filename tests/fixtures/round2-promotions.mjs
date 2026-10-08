import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const workspace = process.argv[2];
if (!workspace) throw new Error("需要提供验收项目目录");
const doubleEleven = await import(pathToFileURL(path.join(workspace, "src/promotionsDoubleEleven.ts")).href);
const promotion618 = await import(pathToFileURL(path.join(workspace, "src/promotions618.ts")).href);
assert.equal(doubleEleven.applyDoubleElevenDiscount(300), 250);
assert.equal(doubleEleven.applyDoubleElevenDiscount(100), 100);
assert.equal(doubleEleven.applyDoubleElevenDiscount(-1), 0);
assert.ok(Math.abs(promotion618.apply618Discount(100) - 82) < 0.000001);
assert.equal(promotion618.apply618Discount(-1), 0);
console.log("双十一与618的独立验收测试全部通过。");
