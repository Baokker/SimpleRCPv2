import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/hello.ts", import.meta.url), "utf8");

if (!source.includes("hello")) {
  throw new Error("hello export is missing");
}

console.log("sample-workspace-test-ok");
