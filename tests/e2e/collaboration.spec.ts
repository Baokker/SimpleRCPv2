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

  await userA.reload();
  await userA.getByTestId("status-bar").waitFor();
  await expect(userA.getByTestId("member-list").getByText("Ada")).toHaveCount(1);
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

  await acceptPrompt(userA, userA.getByTestId("new-file").click(), "src/new-feature.ts");
  await expect(userA.getByTestId("workspace-tree")).toContainText("new-feature.ts");
  await expect(userB.getByTestId("workspace-tree")).toContainText("new-feature.ts");

  await acceptPrompt(
    userA,
    userA.getByTestId("rename-src/new-feature.ts").click(),
    "src/renamed-feature.ts"
  );
  await expect(userA.getByTestId("workspace-tree")).toContainText(
    "renamed-feature.ts"
  );

  await acceptDialog(userA, userA.getByTestId("delete-src/renamed-feature.ts").click());
  await expect(userA.getByTestId("workspace-tree")).not.toContainText(
    "renamed-feature.ts"
  );
  await expect(userB.getByTestId("workspace-tree")).not.toContainText(
    "renamed-feature.ts"
  );

  await acceptPrompt(userA, userA.getByTestId("new-folder").click(), "src/generated");
  await expect(userA.getByTestId("workspace-tree")).toContainText("generated");
  await expect(userB.getByTestId("workspace-tree")).toContainText("generated");

  await acceptPrompt(
    userA,
    userA.getByTestId("rename-src/generated").click(),
    "src/generated-renamed"
  );
  await expect(userA.getByTestId("workspace-tree")).toContainText(
    "generated-renamed"
  );

  await acceptDialog(
    userA,
    userA.getByTestId("delete-src/generated-renamed").click()
  );
  await expect(userA.getByTestId("workspace-tree")).not.toContainText(
    "generated-renamed"
  );
  await expect(userB.getByTestId("workspace-tree")).not.toContainText(
    "generated-renamed"
  );

  await expect(userA.getByTestId("chat-composer")).toBeVisible();
  await expect(userA.getByTestId("activity-feed")).toBeVisible();

  await expect(userA.getByTestId("command-select")).toHaveValue("npm test");
  await userA.getByTestId("run-command").click();
  await expect(userA.getByTestId("terminal-output")).toContainText(
    "sample-workspace-test-ok"
  );

  await userA.getByTestId("create-agent-task").click();
  await expect(userA.getByTestId("task-list")).toContainText(
    "MockAgent update greeting"
  );
  await userA.getByRole("button", { name: "Run Mock" }).click();

  await expect(userA.getByTestId("terminal-output")).toContainText(
    "MockAgent updated src/hello.ts"
  );
  await expect(userA.getByTestId("activity-feed")).toContainText(
    "agent_reported"
  );

  const { events } = await fetchEvents(userA);
  expect(events.map((event) => event.type)).toEqual(
    expect.arrayContaining([
      "room_created",
      "member_joined",
      "member_rejoined",
      "file_opened",
      "workspace_file_created",
      "workspace_directory_created",
      "workspace_path_renamed",
      "workspace_path_deleted",
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

async function acceptPrompt(
  page: import("@playwright/test").Page,
  trigger: Promise<unknown>,
  value: string
) {
  const dialogPromise = page.waitForEvent("dialog");
  const dialog = await dialogPromise;
  await dialog.accept(value);
  await trigger;
}

async function acceptDialog(
  page: import("@playwright/test").Page,
  trigger: Promise<unknown>
) {
  const dialogPromise = page.waitForEvent("dialog");
  const dialog = await dialogPromise;
  await dialog.accept();
  await trigger;
}
