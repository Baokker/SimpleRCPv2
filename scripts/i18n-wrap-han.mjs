// Wrap hard-coded Chinese text in L("...") calls so that it can be translated.
//
// Usage: node scripts/i18n-wrap-han.mjs <module> <file>...       rewrite files in place (module without extension)
//        node scripts/i18n-wrap-han.mjs --list <file>...         print the message keys
//
// String literals, template literals, and JSX text that contain Chinese become
// L("source") or L("source {0}", value). Template expressions become numbered
// placeholders. Strings passed to .includes()/.startsWith() are left alone,
// because they match text produced elsewhere.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require(require.resolve("typescript", { paths: [process.cwd() + "/apps/client"] }));
const han = /\p{Script=Han}/u;

function keep(node) {
  const parent = node.parent;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression)
      && ["includes", "startsWith", "endsWith", "test", "match"].includes(parent.expression.name.text)) return true;
  if (ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && parent.expression.text === "L") return true;
  return false;
}

function collect(file, text = fs.readFileSync(file, "utf8")) {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const edits = [];
  const keys = [];
  const visit = (node) => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && han.test(node.text) && !keep(node)) {
      const call = `L(${JSON.stringify(node.text)})`;
      const inJsxAttr = ts.isJsxAttribute(node.parent);
      edits.push([node.getStart(source), node.getEnd(), inJsxAttr ? `{${call}}` : call]);
      keys.push(node.text);
      return;
    }
    if (ts.isTemplateExpression(node) && han.test(node.getText(source)) && !keep(node)) {
      let key = node.head.text;
      const args = [];
      node.templateSpans.forEach((span, index) => {
        key += `{${index}}` + span.literal.text;
        args.push(span.expression.getText(source));
      });
      edits.push([node.getStart(source), node.getEnd(), `L(${JSON.stringify(key)}, ${args.join(", ")})`]);
      keys.push(key);
      return;
    }
    if (ts.isJsxText(node) && han.test(node.text)) {
      const raw = node.getText(source);
      const lead = raw.match(/^\s*/)[0];
      const trail = raw.match(/\s*$/)[0];
      const body = raw.trim();
      edits.push([node.getStart(source, true), node.getEnd(), `${lead}{L(${JSON.stringify(body)})}${trail}`]);
      keys.push(body);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { text, edits, keys };
}

function rewrite(file) {
  // Nested templates are wrapped on later passes, so repeat until stable.
  let text = fs.readFileSync(file, "utf8");
  const keys = [];
  let total = 0;
  for (;;) {
    const { edits, keys: found } = collect(file, text);
    if (!edits.length) break;
    for (const [start, end, replacement] of edits.sort((a, b) => b[0] - a[0])) {
      text = text.slice(0, start) + replacement + text.slice(end);
    }
    keys.push(...found);
    total += edits.length;
  }
  return { text, keys, total };
}

const args = process.argv.slice(2);
if (args[0] === "--list") {
  const all = new Set();
  for (const file of args.slice(1)) rewrite(file).keys.forEach((key) => all.add(key));
  process.stdout.write(JSON.stringify([...all], null, 1) + "\n");
} else {
  const [modulePath, ...files] = args;
  const importPath = (file) => {
    const rel = path.relative(path.dirname(file), path.resolve(modulePath)).replace(/\\/g, "/");
    return rel.startsWith(".") ? rel : `./${rel}`;
  };
  for (const file of files) {
    let { text: out, total } = rewrite(file);
    if (!total) continue;
    if (!/import \{ L \} from/.test(out)) {
      const lines = out.split("\n");
      let last = -1;
      lines.forEach((line, index) => { if (/^import .* from ["'].*["'];?$/.test(line)) last = index; });
      lines.splice(last + 1, 0, `import { L } from "${importPath(file)}";`);
      out = lines.join("\n");
    }
    fs.writeFileSync(file, out);
    console.log(`${file}: ${total} strings`);
  }
}
