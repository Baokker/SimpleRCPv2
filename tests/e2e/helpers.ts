import type { Page } from "@playwright/test";

export async function openAs(page: Page, name: string, projectId = "demo") {
  const params = new URLSearchParams({ name });
  await page.goto(`/projects/${projectId}?${params.toString()}`);
  await page.getByTestId("status-bar").waitFor();
}

export async function fetchEvents(page: Page, projectId = "demo") {
  return page.evaluate(async (activeProjectId) => {
    const response = await fetch(`/api/projects/${activeProjectId}/events`);
    return response.json() as Promise<{
      events: Array<{ type: string; payload?: Record<string, unknown> }>;
    }>;
  }, projectId);
}
