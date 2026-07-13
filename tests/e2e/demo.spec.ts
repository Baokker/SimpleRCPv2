import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { openAs } from "./helpers";

const recordVideo = process.env.SIMPLERCP_RECORD_VIDEO === "1";

test.skip(!recordVideo, "Run with pnpm demo:record to create the video artifact");

test("record a reviewable collaboration session", async ({ browser }) => {
  await fs.mkdir("artifacts", { recursive: true });
  const hostContext = await browser.newContext({
    recordVideo: {
      dir: path.join("test-results", "video"),
      size: { width: 1280, height: 720 }
    }
  });
  const guestContext = await browser.newContext();
  const ada = await hostContext.newPage();
  const linus = await guestContext.newPage();

  await openAs(ada, "Ada", "e2e-host-secret");
  await openAs(linus, "Linus");
  await pause(ada);

  await ada.getByTestId("collab-tab-team").click();
  await expect(ada.getByTestId("member-list")).toContainText("Linus");
  await pause(ada);

  await ada.getByTestId("dir-src").click();
  await linus.getByTestId("dir-src").click();
  await ada.getByTestId("follow-member-Linus").click();
  await linus.getByTestId("file-src/sample.py").click();
  await expect(ada.locator(".tab.active")).toContainText("src/sample.py");
  await pause(ada);

  await linus.getByTestId("file-src/hello.ts").click();
  await expect(ada.locator(".tab.active")).toContainText("src/hello.ts");
  await ada.getByTestId("follow-member-Linus").click();
  await pause(ada);

  await typeEditorValue(
    ada,
    "src/hello.ts",
    'export const greeting = "Hello from Ada";'
  );
  await expectEditorValue(
    linus,
    "src/hello.ts",
    'export const greeting = "Hello from Ada";'
  );
  await selectGreeting(linus, "src/hello.ts");
  await pause(ada);

  await linus.getByTestId("collab-tab-chat").click();
  await linus.getByTestId("chat-input").fill("I can see the shared edit.");
  await linus.getByTestId("send-chat").click();
  await ada.getByTestId("collab-tab-chat").click();
  await expect(ada.getByTestId("chat-transcript")).toContainText(
    "I can see the shared edit."
  );
  await pause(ada);

  await ada.getByTestId("terminal-output").click();
  await ada.keyboard.type("printf 'shared-terminal-demo-ok\\n'", {
    delay: 30
  });
  await ada.keyboard.press("Enter");
  await expect(ada.getByTestId("terminal-output")).toContainText(
    "shared-terminal-demo-ok"
  );
  await expect(linus.getByTestId("terminal-output")).toContainText(
    "shared-terminal-demo-ok"
  );
  await pause(ada);

  await ada.getByTestId("collab-tab-team").click();
  await expect(ada.getByTestId("activity-feed")).toContainText(
    "Linus: I can see the shared edit."
  );
  await ada.screenshot({
    path: "artifacts/collaboration-demo-final.png",
    fullPage: true
  });
  await pause(ada, 1_200);

  const video = ada.video();
  await guestContext.close();
  await hostContext.close();
  if (!video) throw new Error("Playwright video was not created");
  await video.saveAs(path.resolve("artifacts/collaboration-demo.webm"));
});

async function typeEditorValue(page: Page, filePath: string, value: string) {
  await page.waitForFunction(
    (path) =>
      Boolean(
        (window as typeof window & {
          __simplercpYjsSynced?: Record<string, boolean>;
        }).__simplercpYjsSynced?.[path]
      ),
    filePath
  );
  for (let index = 1; index <= value.length; index += 1) {
    await page.evaluate(
      ({ path, text }) => {
        const editor = (window as typeof window & {
          __simplercpEditors?: Record<string, { setValue(value: string): void }>;
        }).__simplercpEditors?.[path];
        if (!editor) throw new Error("Monaco editor is not ready");
        editor.setValue(text);
      },
      { path: filePath, text: value.slice(0, index) }
    );
    await page.waitForTimeout(35);
  }
}

async function expectEditorValue(page: Page, filePath: string, value: string) {
  await page.waitForFunction(
    ({ path, expected }) => {
      const editors = (window as typeof window & {
        __simplercpEditors?: Record<string, { getValue(): string }>;
      }).__simplercpEditors;
      return editors?.[path]?.getValue() === expected;
    },
    { path: filePath, expected: value }
  );
}

async function selectGreeting(page: Page, filePath: string) {
  await page.evaluate((path) => {
    const editor = (window as typeof window & {
      __simplercpEditors?: Record<
        string,
        {
          focus(): void;
          setSelection(selection: {
            startLineNumber: number;
            startColumn: number;
            endLineNumber: number;
            endColumn: number;
          }): void;
        }
      >;
    }).__simplercpEditors?.[path];
    editor?.focus();
    editor?.setSelection({
      startLineNumber: 1,
      startColumn: 26,
      endLineNumber: 1,
      endColumn: 40
    });
  }, filePath);
}

async function pause(page: Page, duration = 800) {
  await page.waitForTimeout(duration);
}
