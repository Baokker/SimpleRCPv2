const projectIndex = process.argv.indexOf("--project");
const projectId = projectIndex >= 0 ? process.argv[projectIndex + 1] : undefined;
if (!projectId) throw new Error("--project <id> is required");
const origin = process.env.SIMPLERCP_SERVER_ORIGIN ?? "http://127.0.0.1:4000";
const token = process.env.SIMPLERCP_ADMIN_TOKEN;
if (!token) throw new Error("SIMPLERCP_ADMIN_TOKEN is required");
const response = await fetch(`${origin}/api/projects/${encodeURIComponent(projectId)}/invites`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({})
});
if (!response.ok) throw new Error(await response.text());
console.log((await response.json()).url);
