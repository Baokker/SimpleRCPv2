import type { Page } from "@playwright/test";

export async function openAs(page: Page, name: string, projectId = "demo", role = "") {
  await page.goto(`/projects/${projectId}`);
  await page.getByTestId("display-name").fill(name);
  await page.getByTestId("member-role").fill(role);
  await page.getByTestId("join-project").click();
  await page.getByTestId("status-bar").waitFor();
}

export async function fetchEvents(page: Page, projectId = "demo") {
  return page.evaluate(async (activeProjectId) => {
    const response = await fetch(`/api/projects/${activeProjectId}/events`, {
      headers: { "X-SimpleRCP-Member": localStorage.getItem(`simplercp.memberId.${activeProjectId}`) ?? "" }
    });
    return response.json() as Promise<{
      events: Array<{ type: string; payload?: Record<string, unknown> }>;
    }>;
  }, projectId);
}
