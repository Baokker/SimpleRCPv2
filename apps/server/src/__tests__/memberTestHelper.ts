import { expect } from "vitest";

export function memberHeaders(memberId: string) {
  return { "content-type": "application/json", "X-SimpleRCP-Member": memberId };
}

export async function joinMember(origin: string, projectId: string, input: { name: string; role?: string; memberId?: string; connectionId?: string }) {
  const response = await fetch(`${origin}/api/projects/${encodeURIComponent(projectId)}/members`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input)
  });
  expect(response.status).toBe(200);
  const body = await response.json() as { member: { id: string; profileRole?: string }; participant: { id: string; displayName: string; profileRole?: string } };
  return {
    ...body,
    headers: memberHeaders(body.member.id),
    request(endpoint: string, init?: RequestInit) {
      const headers = new Headers(init?.headers);
      headers.set("X-SimpleRCP-Member", body.member.id);
      return fetch(`${origin}/api/projects/${encodeURIComponent(projectId)}${endpoint}`, { ...init, headers });
    }
  };
}
