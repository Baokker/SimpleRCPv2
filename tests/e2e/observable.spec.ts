import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { openAs } from "./helpers";

test("people, chat, agent runs, terminal, and timeline are observable", async ({
  browser
}) => {
  const context = await browser.newContext();
  const bob = await context.newPage();
  await openAs(bob, "Bob");

  await bob.close();
  const bobAgain = await context.newPage();
  await openAs(bobAgain, "Bob");
  await bobAgain.getByTestId("collab-tab-team").click();
  await waitForConnectionCount(bobAgain, "Bob", 1);
  await expect(bobAgain.getByTestId("member-list").getByText("Bob")).toHaveCount(1);

  const bobSecondTab = await context.newPage();
  await openAs(bobSecondTab, "Bob");
  await expect(bobAgain.getByTestId("member-list")).toContainText("2 tabs");

  const collaboratorContext = await browser.newContext();
  const ada = await collaboratorContext.newPage();
  await openAs(ada, "Ada");
  await bobAgain.getByTestId("collab-tab-chat").click();
  await bobAgain.getByTestId("chat-input").fill("hello Ada");
  await bobAgain.getByTestId("send-chat").click();
  await expect(ada.getByTestId("chat-transcript")).toContainText("hello Ada");

  await expect(bobAgain.getByTestId("agent-mention-hint")).toContainText(
    "@DeepSeek"
  );
  await bobAgain
    .getByTestId("chat-input")
    .fill("@DeepSeek please update the sample and run tests");
  await bobAgain.getByTestId("send-chat").click();
  await expect(bobAgain.getByTestId("chat-transcript")).toContainText(
    "DeepSeek updated src/hello.ts and ran npm test."
  );
  await bobAgain.getByTestId("collab-tab-runs").click();
  await expect(bobAgain.getByTestId("agent-runs")).toContainText("DeepSeek");
  await expect(bobAgain.getByTestId("agent-runs")).toContainText("completed");
  await bobAgain.getByTestId("collab-tab-timeline").click();
  await expect(bobAgain.getByTestId("timeline-list")).toContainText(
    "DeepSeek completed the chat request"
  );

  await bobAgain.getByTestId("collab-tab-chat").click();
  await bobAgain.getByTestId("chat-input").fill("@MockAgent please update the sample");
  await bobAgain.getByTestId("send-chat").click();
  await expect(bobAgain.getByTestId("chat-transcript")).toContainText(
    "MockAgent updated src/hello.ts"
  );
  await bobAgain.getByTestId("collab-tab-runs").click();
  await expect(bobAgain.getByTestId("agent-runs")).toContainText("completed");

  await expect(bobAgain.getByTestId("command-mode")).toContainText(
    "unrestricted"
  );
  await bobAgain
    .getByTestId("command-input")
    .fill("node -e \"console.log('adhoc-ui-ok')\"");
  await bobAgain.getByTestId("run-command").click();
  await expect(bobAgain.getByTestId("terminal-output")).toContainText(
    "adhoc-ui-ok"
  );

  await bobAgain.getByTestId("collab-tab-timeline").click();
  await bobAgain.getByTestId("run-scenario").click();
  await expect(bobAgain.getByTestId("timeline-list")).toContainText(
    "bob asked MockAgent for help"
  );
  await expect(bobAgain.getByTestId("timeline-list")).toContainText(
    "MockAgent ran npm test"
  );
  await expect(bobAgain.getByTestId("timeline-list")).toContainText(
    "tests passed"
  );

  await fs.mkdir("artifacts", { recursive: true });
  await bobAgain.screenshot({
    path: "artifacts/observable-final.png",
    fullPage: true
  });
  const timeline = await bobAgain.evaluate(async () => {
    const health = (await fetch("/api/health").then((response) =>
      response.json()
    )) as { roomId: string };
    return fetch(`/api/rooms/${health.roomId}/timeline`).then((response) =>
      response.json()
    );
  });
  await fs.writeFile(
    path.join("artifacts", "observable-timeline.json"),
    JSON.stringify(timeline, null, 2)
  );

  await context.close();
  await collaboratorContext.close();
});

async function waitForConnectionCount(
  page: import("@playwright/test").Page,
  name: string,
  count: number
) {
  await page.waitForFunction(
    async ({ expectedName, expectedCount }) => {
      const health = (await fetch("/api/health").then((response) =>
        response.json()
      )) as { roomId: string };
      const roomResponse = (await fetch(`/api/rooms/${health.roomId}`).then(
        (response) => response.json()
      )) as {
        room: {
          members: Array<{ name: string; connectionCount: number }>;
        };
      };
      return roomResponse.room.members.some(
        (member) =>
          member.name === expectedName && member.connectionCount === expectedCount
      );
    },
    { expectedName: name, expectedCount: count }
  );
}
