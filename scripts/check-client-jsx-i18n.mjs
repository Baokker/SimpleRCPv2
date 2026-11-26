import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../apps/client/src/", import.meta.url));
const textAttributes = new Set([
  "alt", "aria-description", "aria-label", "placeholder", "title"
]);
const fixedLabels = new Set([
  "SimpleRCP", "OpenCode", "DeepSeek", "API Key", "· v",
  "/agent new reviewer code reviews", "@reviewer",
  "/srv/projects/example", "src/components/Button.tsx", "src/components"
]);
const failures = [];

function checkFile(file) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);

  function checkText(node, value) {
    const label = value.replace(/\s+/g, " ").trim();
    if (!/[A-Za-z]/.test(label) || fixedLabels.has(label)) return;
    if (relative(root, file) === join("components", "LanguageSwitcher.tsx") && label === "English") return;
    const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
    failures.push(`apps/client/src/${relative(root, file)}:${line + 1}:${character + 1} ${label}`);
  }

  function checkExpression(expression) {
    if (ts.isStringLiteralLike(expression)) {
      checkText(expression, expression.text);
    } else if (ts.isTemplateExpression(expression)) {
      checkText(expression, [expression.head.text, ...expression.templateSpans.map((span) => span.literal.text)].join(" "));
    } else if (ts.isConditionalExpression(expression)) {
      checkExpression(expression.whenTrue);
      checkExpression(expression.whenFalse);
    } else if (ts.isParenthesizedExpression(expression)) {
      checkExpression(expression.expression);
    } else if (ts.isBinaryExpression(expression)) {
      const operator = expression.operatorToken.kind;
      if (operator === ts.SyntaxKind.PlusToken || operator === ts.SyntaxKind.BarBarToken || operator === ts.SyntaxKind.QuestionQuestionToken) {
        checkExpression(expression.left);
        checkExpression(expression.right);
      } else if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
        checkExpression(expression.right);
      }
    }
  }

  function visit(node) {
    if (ts.isJsxText(node)) {
      checkText(node, node.text);
    } else if (ts.isJsxAttribute(node) && textAttributes.has(node.name.getText(source))) {
      if (node.initializer && ts.isStringLiteral(node.initializer)) checkText(node.initializer, node.initializer.text);
      if (node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        checkExpression(node.initializer.expression);
      }
    } else if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) {
      checkExpression(node.expression);
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
}

function scan(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) scan(path);
    else if (/\.[jt]sx$/.test(entry.name)) checkFile(path);
  }
}

scan(root);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("前端 JSX 英文文案检查通过");
}
