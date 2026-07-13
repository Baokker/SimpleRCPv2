import type { Page } from "@playwright/test";

export async function openAs(page: Page, name: string, hostToken?: string) {
  const params = new URLSearchParams({ name });
  if (hostToken) params.set("hostToken", hostToken);
  await page.goto(`/?${params.toString()}`);
  await page.getByTestId("status-bar").waitFor();
}

export async function fetchEvents(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/events");
    return response.json() as Promise<{
      events: Array<{ type: string; payload?: Record<string, unknown> }>;
    }>;
  });
}
