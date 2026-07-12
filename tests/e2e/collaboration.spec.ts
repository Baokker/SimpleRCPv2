import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import { openAs } from "./helpers";

test("human collaborators share code, cursors, chat, activity, and terminal", async ({
  browser
}) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const ada = await contextA.newPage();
  const linus = await contextB.newPage();

  await openAs(ada, "Ada");
  await openAs(linus, "Linus");

  await ada.getByTestId("collab-tab-team").click();
  await expect(ada.getByTestId("member-list")).toContainText("Ada");
  await expect(ada.getByTestId("member-list")).toContainText("Linus");
  await expect(ada.getByTestId("activity-feed")).toContainText(
    "Linus joined the session"
  );

  await expect(ada.getByTestId("dir-src")).toHaveAttribute(
    "aria-expanded",
    "false"
  );
  await ada.getByTestId("dir-src").click();
  await linus.getByTestId("dir-src").click();

  await expect(ada.getByTestId("dir-target")).toBeVisible();
  await ada.getByTestId("dir-target").click();
  await ada.getByTestId("dir-target/classes").click();
  await handleNextDialog(ada, "alert", "binary file", "accept", () =>
    ada.getByTestId("file-target/classes/Main.class").click()
  );
  await expect(
    ada.getByTestId("close-tab-target/classes/Main.class")
  ).toHaveCount(0);

  await ada.getByTestId("dir-target/generated").click();
  await handleNextDialog(
    ada,
    "confirm",
    "Large files may slow down collaboration",
    "dismiss",
    () => ada.getByTestId("file-target/generated/large.js").click()
  );
  await expect(
    ada.getByTestId("close-tab-target/generated/large.js")
  ).toHaveCount(0);
  await handleNextDialog(ada, "confirm", "Large files", "accept", () =>
    ada.getByTestId("file-target/generated/large.js").click()
  );
  await expect(
    ada.getByTestId("close-tab-target/generated/large.js")
  ).toBeVisible();
  await ada.getByTestId("close-tab-target/generated/large.js").click();

  await ada.getByTestId("file-src/hello.ts").click();
  await linus.getByTestId("file-src/hello.ts").click();

  await ada.getByTestId("file-src/sample.py").click();
  await triggerPythonSuggestions(ada, "src/sample.py", "de");
  await expect(ada.locator(".suggest-widget")).toBeVisible();
  await expect(ada.locator(".suggest-widget")).toContainText("def");
  await ada.keyboard.press("Escape");

  await ada.getByTestId("close-tab-src/sample.py").click();
  await expect(ada.getByTestId("close-tab-src/sample.py")).toHaveCount(0);
  await expect(ada.getByTestId("close-tab-src/hello.ts")).toBeVisible();

  await setMonacoSelection(ada, "src/hello.ts", {
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: 1,
    endColumn: 13
  });
  await expectRemoteCursor(linus, "src/hello.ts", "Ada");

  await replaceMonacoText(ada, "src/hello.ts", 'export const hello = "collab";');
  await expect(linus.getByTestId("editor-frame")).toContainText("collab");

  await ada.getByTestId("collab-tab-chat").click();
  await ada.getByTestId("chat-input").fill("Linus, I updated the greeting.");
  await ada.getByTestId("send-chat").click();
  await expect(linus.getByTestId("chat-transcript")).toContainText(
    "Linus, I updated the greeting."
  );

  await expect(ada.getByTestId("command-mode")).toContainText("unrestricted");
  await ada.getByTestId("command-input").fill("npm test");
  await ada.getByTestId("run-command").click();
  await expect(ada.getByTestId("terminal-output")).toContainText(
    "sample-workspace-test-ok"
  );

  await ada.getByTestId("collab-tab-team").click();
  await expect(ada.getByTestId("activity-feed")).toContainText(
    "Ada opened src/hello.ts"
  );
  await expect(ada.getByTestId("activity-feed")).toContainText(
    "Ada edited src/hello.ts"
  );
  await expect(ada.getByTestId("activity-feed")).toContainText(
    "Ada: Linus, I updated the greeting."
  );
  await expect(ada.getByTestId("activity-feed")).toContainText(
    "Ada ran npm test"
  );

  await fs.mkdir("artifacts", { recursive: true });
  await ada.screenshot({
    path: "artifacts/collaboration-core.png",
    fullPage: true
  });

  await ada.setViewportSize({ width: 860, height: 900 });
  const terminalBox = await ada.locator(".terminal-pane").boundingBox();
  const collaborationBox = await ada.locator(".collab-pane").boundingBox();
  expect(terminalBox).not.toBeNull();
  expect(collaborationBox).not.toBeNull();
  expect((terminalBox?.y ?? 0) + (terminalBox?.height ?? 0)).toBeLessThanOrEqual(
    collaborationBox?.y ?? 0
  );
  const peopleBox = await ada.getByTestId("member-list").boundingBox();
  const activityHeadingBox = await ada.locator(".activity-block h2").boundingBox();
  expect(peopleBox).not.toBeNull();
  expect(activityHeadingBox).not.toBeNull();
  expect((peopleBox?.y ?? 0) + (peopleBox?.height ?? 0)).toBeLessThanOrEqual(
    activityHeadingBox?.y ?? 0
  );
  await ada.screenshot({
    path: "artifacts/collaboration-core-narrow.png",
    fullPage: true
  });

  await contextB.close();
  await expect(ada.getByTestId("activity-feed")).toContainText(
    "Linus left the session"
  );

  await contextA.close();
});

async function replaceMonacoText(
  page: import("@playwright/test").Page,
  path: string,
  text: string
) {
  await page.waitForFunction(
    (filePath) =>
      Boolean(
        (
          window as typeof window & {
            __simplercpEditors?: Record<string, { setValue(value: string): void }>;
          }
        ).__simplercpEditors?.[filePath]
      ),
    path
  );
  await page.evaluate(
    ({ filePath, nextText }) => {
      const editor = (
        window as typeof window & {
          __simplercpEditors?: Record<string, { setValue(value: string): void }>;
        }
      ).__simplercpEditors?.[filePath];
      if (!editor) throw new Error("Monaco editor is not ready");
      editor.setValue(nextText);
    },
    { filePath: path, nextText: text }
  );
}

async function setMonacoSelection(
  page: import("@playwright/test").Page,
  path: string,
  selection: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  }
) {
  await page.waitForFunction(
    (filePath) =>
      Boolean(
        (
          window as typeof window & {
            __simplercpEditors?: Record<string, unknown>;
          }
        ).__simplercpEditors?.[filePath]
      ),
    path
  );
  await page.evaluate(
    ({ filePath, nextSelection }) => {
      const editor = (
        window as typeof window & {
          __simplercpEditors?: Record<
            string,
            { setSelection(selection: typeof nextSelection): void; focus(): void }
          >;
        }
      ).__simplercpEditors?.[filePath];
      if (!editor) throw new Error("Monaco editor is not ready");
      editor.focus();
      editor.setSelection(nextSelection);
    },
    { filePath: path, nextSelection: selection }
  );
}

async function expectRemoteCursor(
  page: import("@playwright/test").Page,
  path: string,
  displayName: string
) {
  await page.waitForFunction(
    ({ filePath, name }) => {
      const editor = (
        window as typeof window & {
          __simplercpEditors?: Record<
            string,
            {
              getModel(): {
                getAllDecorations(): Array<{
                  options: {
                    after?: { content?: string };
                    className?: string;
                  };
                }>;
              } | null;
            }
          >;
        }
      ).__simplercpEditors?.[filePath];
      const decorations = editor?.getModel()?.getAllDecorations() ?? [];
      return (
        decorations.some(
          (decoration) => decoration.options.after?.content === ` ${name}`
        ) &&
        decorations.some((decoration) =>
          decoration.options.className?.includes("remote-selection")
        )
      );
    },
    { filePath: path, name: displayName }
  );
}

async function triggerPythonSuggestions(
  page: import("@playwright/test").Page,
  path: string,
  text: string
) {
  await page.waitForFunction(
    (filePath) =>
      Boolean(
        (
          window as typeof window & {
            __simplercpEditors?: Record<string, unknown>;
          }
        ).__simplercpEditors?.[filePath]
      ),
    path
  );
  await page.evaluate(
    ({ filePath, value }) => {
      const editor = (
        window as typeof window & {
          __simplercpEditors?: Record<
            string,
            {
              setValue(value: string): void;
              setPosition(position: { lineNumber: number; column: number }): void;
              trigger(source: string, handlerId: string, payload: object): void;
              focus(): void;
            }
          >;
        }
      ).__simplercpEditors?.[filePath];
      if (!editor) throw new Error("Monaco editor is not ready");
      editor.setValue(value);
      editor.setPosition({ lineNumber: 1, column: value.length + 1 });
      editor.focus();
      editor.trigger("e2e", "editor.action.triggerSuggest", {});
    },
    { filePath: path, value: text }
  );
}

async function handleNextDialog(
  page: import("@playwright/test").Page,
  type: "alert" | "confirm",
  message: string,
  action: "accept" | "dismiss",
  trigger: () => Promise<unknown>
) {
  const dialogHandled = (async () => {
    const dialog = await page.waitForEvent("dialog");
    expect(dialog.type()).toBe(type);
    expect(dialog.message()).toContain(message);
    await dialog[action]();
  })();
  await Promise.all([trigger(), dialogHandled]);
}
