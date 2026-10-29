// B6: withdraw an Agent's changes after another member edited the same file.
// Each case starts from one base file. The withdrawn actor changes it first, another member (or Agent)
// changes it afterwards, then selectAgentReverts withdraws the first actor's changes.
// A case is correct when the withdrawn change is undone and the later change is kept,
// or when the overlapping part is left untouched and handed to a person.
import fs from "node:fs/promises";
import { selectAgentReverts } from "../../../../../packages/conflict-guard/dist/coordination/agentGuard.js";

const base = Array.from({ length: 10 }, (_, index) => `export const v${index + 1} = ${index + 1};\n`).join("");
const replace = (text, line, value) => text.split("\n").map((row, index) => index === line - 1 ? value : row).join("\n");
const insertTop = (text, rows) => rows + text;
const alice = replace(base, 3, "export const v3 = 30;");

const cases = [
  { id: "different-line", note: "其他成员改同一文件的另一行", agent: alice, current: replace(alice, 8, "export const v8 = 80;") },
  { id: "same-line", note: "其他成员改同一行", agent: alice, current: replace(alice, 3, "export const v3 = 300;") },
  { id: "adjacent-line", note: "其他成员改相邻行", agent: alice, current: replace(alice, 4, "export const v4 = 40;") },
  { id: "shifted", note: "其他成员在文件开头插入两行", agent: replace(base, 8, "export const v8 = 80;"), current: insertTop(replace(base, 8, "export const v8 = 80;"), "// a\n// b\n"), withdrawnLine: "export const v8 = 80;", otherLine: "// a" },
  { id: "renamed", note: "其他成员把文件改名，原路径不存在", agent: alice, current: "" },
  { id: "two-agents", note: "两个 Agent 运行重叠，各改一个位置", agent: alice, current: replace(alice, 8, "export const v8 = 81;") },
  { id: "inside-agent-block", note: "另一个 Agent 在被撤回的修改内部继续修改", agent: alice, current: replace(alice, 3, "export const v3 = 30; // checked") }
];

const results = cases.map((item) => {
  const withdrawnLine = item.withdrawnLine ?? "export const v3 = 30;";
  const otherLine = item.otherLine ?? item.current.split("\n").find((row, index) => row !== item.agent.split("\n")[index]);
  const selected = selectAgentReverts(base, item.agent, item.current);
  const undone = !selected.text.includes(withdrawnLine) || selected.text === item.current && !item.current.includes(withdrawnLine);
  const kept = otherLine === undefined ? null : selected.text.includes(otherLine);
  const handedToPerson = selected.skipped.length > 0;
  const lostOther = kept === false;
  return { id: item.id, note: item.note, reverted: selected.reverted.length, skipped: selected.skipped.length, withdrawnUndone: undone && selected.reverted.length > 0, otherKept: kept, handedToPerson, lostOther, correct: !lostOther && (selected.reverted.length > 0 && undone || handedToPerson) };
});
await fs.writeFile(new URL("./results.json", import.meta.url), JSON.stringify({ base: "10-line TypeScript module", results }, null, 2) + "\n");
console.table(results.map(({ note, ...rest }) => rest));
