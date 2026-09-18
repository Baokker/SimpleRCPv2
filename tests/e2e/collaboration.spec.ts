import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchEvents, openAs } from "./helpers";

const workspaceRoot = fileURLToPath(
  new URL("../../.test-workspaces/e2e-data/projects/demo/workspace/", import.meta.url)
);

test("human collaborators share code, cursors, chat, activity, and terminal", async ({
  browser
}) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const ada = await contextA.newPage();
  const linus = await contextB.newPage();

  await openAs(ada, "Ada");
  await openAs(linus, "Linus");

  await expect(ada.getByTestId("projects-link")).toBeVisible();
  await expect(ada.getByTestId("command-input")).toHaveCount(0);
  await ada.getByTestId("toggle-collaboration").click();
  await expect(ada.locator(".collab-pane")).toBeHidden();
  await ada.getByTestId("toggle-collaboration").click();
  await expect(ada.locator(".collab-pane")).toBeVisible();
  await ada.getByTestId("toggle-terminal").click();
  await expect(ada.locator(".terminal-pane")).toBeHidden();
  await ada.getByTestId("toggle-terminal").click();
  await expect(ada.locator(".terminal-pane")).toBeVisible();

  await fs.mkdir("artifacts", { recursive: true });
  await ada.getByTestId("collab-tab-project").click();
  await expect(ada.getByTestId("project-panel")).toContainText("Collaborator");

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
  await expect(ada.getByTestId("file-src/hello.ts")).toHaveCount(0);
  await ada.getByTestId("dir-src").click();
  await linus.getByTestId("dir-src").click();

  await ada.getByTestId("collab-tab-team").click();
  await ada.getByTestId("follow-member-Linus").click();
  await linus.getByTestId("file-src/sample.py").click();
  await expect(ada.locator(".tab.active")).toContainText("src/sample.py");
  await ada.getByTestId("follow-member-Linus").click();
  await linus.getByTestId("file-src/hello.ts").click();
  await expect(ada.locator(".tab.active")).toContainText("src/sample.py");

  await fs.mkdir(path.join(workspaceRoot, "watcher-output"));
  await fs.writeFile(
    path.join(workspaceRoot, "watcher-output", "result.txt"),
    "created outside the browser"
  );
  await expect(ada.getByTestId("dir-watcher-output")).toBeVisible();
  await ada.getByTestId("dir-watcher-output").click();
  await expect(ada.getByTestId("file-watcher-output/result.txt")).toBeVisible();

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

  await waitForCollaborativeEditor(ada, "src/hello.ts");
  await expect(ada.getByTestId("editor-collaboration-status")).toHaveCount(0);

  await replaceMonacoText(ada, "src/hello.ts", "middle");
  await expectMonacoValue(linus, "src/hello.ts", "middle");
  await expect(ada.getByTestId("editor-save-status")).toContainText("Saved");
  await Promise.all([
    insertMonacoText(ada, "src/hello.ts", "start", "Ada "),
    insertMonacoText(linus, "src/hello.ts", "end", " Linus")
  ]);
  await expectMonacoValue(ada, "src/hello.ts", "Ada middle Linus");
  await expectMonacoValue(linus, "src/hello.ts", "Ada middle Linus");
  await expect
    .poll(() => fs.readFile(path.join(workspaceRoot, "src/hello.ts"), "utf8"))
    .toBe("Ada middle Linus");
  await fs.writeFile(
    path.join(workspaceRoot, "src/hello.ts"),
    "external watcher update"
  );
  await expectMonacoValue(ada, "src/hello.ts", "external watcher update");
  await expectMonacoValue(linus, "src/hello.ts", "external watcher update");

  await expect(ada.getByTestId("close-tab-src/hello.ts")).toBeVisible();

  await expect(ada.getByTestId("new-file")).toHaveAttribute(
    "title",
    "Create file by path"
  );
  await expect(ada.getByTestId("new-folder")).toHaveAttribute(
    "title",
    "Create folder by path"
  );
  await openWorkspaceDialog(ada, "new-file", "src/browser-created.ts", "src/");
  await expect(ada.getByTestId("file-src/browser-created.ts")).toBeVisible();
  await expect(linus.getByTestId("file-src/browser-created.ts")).toBeVisible();
  await linus.getByTestId("file-src/browser-created.ts").click();
  await waitForCollaborativeEditor(linus, "src/browser-created.ts");

  await openWorkspaceDialog(ada, "new-folder", "src/browser-folder", "src/");
  await expect(ada.getByTestId("dir-src/browser-folder")).toBeVisible();
  await openWorkspaceDialog(
    ada,
    "rename-src/browser-created.ts",
    "src/browser-renamed.ts"
  );
  await expect(ada.getByTestId("file-src/browser-renamed.ts")).toBeVisible();
  await expect(ada.getByTestId("close-tab-src/browser-renamed.ts")).toBeVisible();
  await expect(linus.getByTestId("close-tab-src/browser-renamed.ts")).toBeVisible();
  await openDeleteDialog(ada, "src/browser-renamed.ts");
  await expect(ada.getByTestId("file-src/browser-renamed.ts")).toHaveCount(0);
  await expect(ada.getByTestId("close-tab-src/browser-renamed.ts")).toHaveCount(0);
  await expect(linus.getByTestId("close-tab-src/browser-renamed.ts")).toHaveCount(0);
  await expect(linus.getByTestId("workspace-notice")).toContainText(
    "src/browser-renamed.ts was deleted"
  );
  await openDeleteDialog(ada, "src/browser-folder");
  await expect(ada.getByTestId("dir-src/browser-folder")).toHaveCount(0);
  await ada.getByTestId("file-src/hello.ts").click();

  await setMonacoSelection(ada, "src/hello.ts", {
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: 1,
    endColumn: 13
  });
  await expectRemoteCursor(linus, "src/hello.ts", "Ada");

  await expect.poll(async () => changedFileEvents(ada)).toBeGreaterThan(0);
  await ada.waitForTimeout(2_100);
  const editEventsBefore = await changedFileEvents(ada);
  await replaceMonacoText(
    ada,
    "src/hello.ts",
    'export const hello = "collab";\nexport const count = 1;'
  );
  await replaceMonacoText(
    ada,
    "src/hello.ts",
    'export const hello = "collab";\nexport const count = 2;'
  );
  await expect(linus.getByTestId("editor-frame")).toContainText("collab");
  await expect.poll(async () => changedFileEvents(ada)).toBe(editEventsBefore + 1);

  await ada.getByTestId("collab-tab-chat").click();
  await expect(
    ada.getByText("Enter to send / Shift + Enter for new line")
  ).toBeVisible();
  const chatInput = ada.getByTestId("chat-input");
  await expect(ada.getByTestId("send-chat")).toBeDisabled();
  await chatInput.fill("Linus, I updated");
  await expect(ada.getByTestId("send-chat")).toBeEnabled();
  await chatInput.press("Shift+Enter");
  await chatInput.pressSequentially("the greeting.");
  await expect(chatInput).toHaveValue("Linus, I updated\nthe greeting.");
  await chatInput.press("Enter");
  await expect(chatInput).toHaveValue("");
  await linus.getByTestId("collab-tab-chat").click();
  const receivedMessage = linus.locator(".chat-message p").last();
  await expect(receivedMessage).toHaveText("Linus, I updated\nthe greeting.");

  await ada.getByTestId("terminal-output").click();
  await ada.keyboard.type("printf 'shared-pty-ok\\n'");
  await ada.keyboard.press("Enter");
  await expect(ada.getByTestId("terminal-output")).toContainText(
    "shared-pty-ok"
  );
  await expect(linus.getByTestId("terminal-output")).toContainText(
    "shared-pty-ok"
  );

  await ada.getByTestId("collab-tab-team").click();
  await expect(ada.getByTestId("activity-feed")).toContainText(
    "Ada edited src/hello.ts"
  );
  await expect(ada.getByTestId("activity-feed")).toContainText("Lines 1-2");
  await expect(ada.getByTestId("activity-feed")).not.toContainText("opened src/hello.ts");
  await expect(ada.getByTestId("activity-feed")).not.toContainText(
    "Linus, I updated the greeting."
  );
  await ada.getByTestId("file-src/sample.py").click();
  await expect(ada.locator(".tab.active")).toContainText("src/sample.py");
  await ada.getByTitle("Open src/hello.ts").first().click();
  await expect(ada.locator(".tab.active")).toContainText("src/hello.ts");

  await ada.getByTestId("collab-tab-team").click();

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

async function changedFileEvents(page: import("@playwright/test").Page) {
  const { events } = await fetchEvents(page);
  return events.filter((event) => event.type === "file_changed").length;
}

async function replaceMonacoText(
  page: import("@playwright/test").Page,
  path: string,
  text: string
) {
  await waitForCollaborativeEditor(page, path);
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
  await waitForCollaborativeEditor(page, path);
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

async function insertMonacoText(
  page: import("@playwright/test").Page,
  path: string,
  position: "start" | "end",
  text: string
) {
  await waitForCollaborativeEditor(page, path);
  await page.evaluate(
    ({ filePath, insertionPosition, insertedText }) => {
      const editor = (
        window as typeof window & {
          __simplercpEditors?: Record<
            string,
            {
              getModel(): {
                getFullModelRange(): {
                  endLineNumber: number;
                  endColumn: number;
                };
                applyEdits(
                  edits: Array<{
                    range: {
                      startLineNumber: number;
                      startColumn: number;
                      endLineNumber: number;
                      endColumn: number;
                    };
                    text: string;
                  }>
                ): void;
              } | null;
            }
          >;
        }
      ).__simplercpEditors?.[filePath];
      const model = editor?.getModel();
      if (!editor || !model) throw new Error("Monaco editor is not ready");
      const end = model.getFullModelRange();
      const lineNumber = insertionPosition === "start" ? 1 : end.endLineNumber;
      const column = insertionPosition === "start" ? 1 : end.endColumn;
      model.applyEdits([
        {
          range: {
            startLineNumber: lineNumber,
            startColumn: column,
            endLineNumber: lineNumber,
            endColumn: column
          },
          text: insertedText
        }
      ]);
    },
    { filePath: path, insertionPosition: position, insertedText: text }
  );
}

async function expectMonacoValue(
  page: import("@playwright/test").Page,
  path: string,
  expected: string
) {
  await page.waitForFunction(
    ({ filePath, value }) => {
      const editor = (
        window as typeof window & {
          __simplercpEditors?: Record<
            string,
            { getValue(): string }
          >;
        }
      ).__simplercpEditors?.[filePath];
      return editor?.getValue() === value;
    },
    { filePath: path, value: expected }
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

async function waitForCollaborativeEditor(
  page: import("@playwright/test").Page,
  path: string
) {
  await page.waitForFunction(
    (filePath) => {
      const state = window as typeof window & {
        __simplercpEditors?: Record<string, unknown>;
        __simplercpYjsSynced?: Record<string, boolean>;
      };
      return Boolean(
        state.__simplercpEditors?.[filePath] &&
          state.__simplercpYjsSynced?.[filePath]
      );
    },
    path
  );
}

async function openWorkspaceDialog(
  page: import("@playwright/test").Page,
  triggerTestId: string,
  value: string,
  initialValue?: string
) {
  await page.getByTestId(triggerTestId).click();
  await expect(page.getByTestId("workspace-dialog")).toBeVisible();
  const input = page.getByTestId("workspace-path-input");
  if (initialValue !== undefined) await expect(input).toHaveValue(initialValue);
  await input.fill(value);
  await page.getByTestId("workspace-dialog-submit").click();
  await expect(page.getByTestId("workspace-dialog")).toHaveCount(0);
}

async function openDeleteDialog(
  page: import("@playwright/test").Page,
  path: string
) {
  await page.getByTestId(`delete-${path}`).click();
  await expect(page.getByTestId("workspace-dialog")).toContainText(path);
  await page.getByTestId("workspace-dialog-submit").click();
  await expect(page.getByTestId("workspace-dialog")).toHaveCount(0);
}
