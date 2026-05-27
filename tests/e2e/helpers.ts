import type { Page } from "@playwright/test";

export async function openAs(page: Page, name: string) {
  await page.goto(`/?name=${encodeURIComponent(name)}`);
  await page.getByTestId("room-badge").waitFor();
}

export async function fetchEvents(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/events");
    return response.json() as Promise<{
      events: Array<{ type: string; payload?: Record<string, unknown> }>;
    }>;
  });
}
