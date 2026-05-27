import { expect, test } from "@playwright/test";
import { fetchEvents, openAs } from "./helpers";

test("human collaborators and mock agent complete a vertical collaboration flow", async ({
  browser
}) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const userA = await contextA.newPage();
  const userB = await contextB.newPage();

  await openAs(userA, "Ada");
  await openAs(userB, "Linus");

  await expect(userA.getByTestId("member-list")).toContainText("Ada");
  await expect(userA.getByTestId("member-list")).toContainText("Linus");
  await expect(userB.getByTestId("workspace-tree")).toContainText("src");
  await expect(userB.getByTestId("workspace-tree")).toContainText("hello.ts");

  await userA.getByTestId("file-src/hello.ts").click();
  await expect(userA.getByTestId("editor-tabs")).toContainText("src/hello.ts");
  await expect(userB.getByTestId("member-list")).toContainText("src/hello.ts");
  await userB.getByTestId("file-src/hello.ts").click();

  await replaceMonacoText(userA, 'export const hello = "collab";');
  await expect(userB.getByTestId("editor-frame")).toContainText("collab");

  await userA.getByTestId("create-agent-task").click();
  await expect(userA.getByTestId("task-list")).toContainText(
    "MockAgent update greeting"
  );
  await userA.getByRole("button", { name: "Run MockAgent" }).click();

  await expect(userA.getByTestId("terminal-output")).toContainText(
    "MockAgent updated src/hello.ts"
  );
  await expect(userA.getByTestId("event-list")).toContainText(
    "agent_reported"
  );

  const { events } = await fetchEvents(userA);
  expect(events.map((event) => event.type)).toEqual(
    expect.arrayContaining([
      "room_created",
      "member_joined",
      "file_opened",
      "task_created",
      "agent_plan",
      "agent_edited_file",
      "command_started",
      "command_completed",
      "agent_reported",
      "task_completed"
    ])
  );

  await contextA.close();
  await contextB.close();
});

async function replaceMonacoText(
  page: import("@playwright/test").Page,
  text: string
) {
  await page.waitForFunction(
    () =>
      Boolean(
        (
          window as typeof window & {
            __simplercpEditors?: Record<
              string,
              { setValue(value: string): void }
            >;
          }
        ).__simplercpEditors?.["src/hello.ts"]
      ),
    undefined,
    { timeout: 10_000 }
  );
  await page.evaluate((nextText) => {
    const editors = (
      window as typeof window & {
        __simplercpEditors?: Record<string, { setValue(value: string): void }>;
      }
    ).__simplercpEditors;
    const editor = editors?.["src/hello.ts"];
    if (!editor) {
      throw new Error("Monaco editor is not ready");
    }
    editor.setValue(nextText);
  }, text);
}
