import assert from "node:assert/strict";
import { it } from "node:test";
import { copyText } from "../src/clipboard.ts";

it("uses the async clipboard when the page runs in a secure context", async () => {
  const written: string[] = [];
  await copyText("link", { clipboard: { writeText: async (text: string) => { written.push(text); } } });
  assert.deepEqual(written, ["link"]);
});

it("copies through a temporary textarea on plain HTTP pages", async () => {
  const appended: Array<{ value: string; removed: boolean }> = [];
  const doc = {
    body: { appendChild(node: { value: string; removed: boolean }) { appended.push(node); } },
    createElement() {
      return { value: "", removed: false, style: {}, setAttribute() {}, select() {}, remove() { this.removed = true; } };
    },
    execCommand: (command: string) => command === "copy"
  } as unknown as Document;
  await copyText("link", { document: doc });
  assert.equal(appended.length, 1);
  assert.equal(appended[0]!.value, "link");
  assert.equal(appended[0]!.removed, true);
});

it("reports a refused copy so the panel can show the error", async () => {
  const doc = {
    body: { appendChild() {} },
    createElement: () => ({ value: "", style: {}, setAttribute() {}, select() {}, remove() {} }),
    execCommand: () => false
  } as unknown as Document;
  await assert.rejects(copyText("link", { document: doc }), /手动复制/);
});
