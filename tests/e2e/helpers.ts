import { expect, type Page } from "@playwright/test";

export async function openAs(page: Page, name: string, projectId = "demo", role = "") {
  await page.goto(`/projects/${projectId}`);
  await page.getByTestId("display-name").fill(name);
  const selectedRole = role.trim().toLowerCase();
  if (selectedRole) {
    await expect(page.getByTestId("member-role").locator(`option[value="${selectedRole}"]`)).toHaveCount(1);
  }
  await page.getByTestId("member-role").selectOption(selectedRole);
  await page.getByTestId("join-project").click();
  await page.getByTestId("status-bar").waitFor();
}

export async function fetchEvents(page: Page, projectId = "demo") {
  return page.evaluate(async (activeProjectId) => {
    const response = await fetch(`/api/projects/${activeProjectId}/events`, {
      headers: {
        "X-SimpleRCP-Member":
          sessionStorage.getItem(`simplercp.memberId.${activeProjectId}`)
          ?? localStorage.getItem(`simplercp.memberId.${activeProjectId}`)
          ?? ""
      }
    });
    return response.json() as Promise<{
      events: Array<{ type: string; payload?: Record<string, unknown> }>;
    }>;
  }, projectId);
}
