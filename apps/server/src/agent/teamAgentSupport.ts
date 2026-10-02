const HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
const RESERVED_HANDLES = new Set(["system", "all", "here", "everyone"]);

export function normalizeHandle(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export function validateHandle(handle: string) {
  if (!HANDLE_PATTERN.test(handle) || RESERVED_HANDLES.has(handle)) {
    throw new Error("Team Agent handle must use 1-32 lowercase letters, numbers, or hyphens");
  }
  return handle;
}

export function parseMentions(text: string, candidates: Set<string>) {
  const mentions: string[] = [];
  const seen = new Set<string>();
  const pattern = /(^|[^\p{L}\p{N}._%+\-])@([a-z0-9][a-z0-9-]{0,31})\b/giu;
  for (const match of text.matchAll(pattern)) {
    const handle = match[2]?.toLowerCase();
    if (!handle || !candidates.has(handle) || seen.has(handle)) continue;
    seen.add(handle);
    mentions.push(handle);
  }
  return mentions;
}
