import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { sanitize, type GuardConflict } from "@simplercp/conflict-guard";

export interface GuardNotification {
  id: string; memberId: string; runId: string; summary: string; at: number;
  read: boolean; handled: boolean;
  conflict?: GuardConflict;
  level?: "light" | "action";
}

export function createGuardNotificationStore(file: string | undefined, sensitiveValues: string[] = []) {
  let notices: GuardNotification[] = [];
  if (file) {
    try {
      const loaded: unknown = JSON.parse(readFileSync(file, "utf8"));
      if (!Array.isArray(loaded) || !loaded.every((entry) => entry && typeof entry === "object" && ["id", "memberId", "runId", "summary"].every((key) => typeof entry[key] === "string") && Number.isFinite(entry.at) && typeof entry.read === "boolean" && typeof entry.handled === "boolean")) throw new Error("Invalid notification data");
      notices = sanitize(loaded, sensitiveValues);
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.error("Conflict guard notifications could not be loaded"); }
  }
  let saving = Promise.resolve();
  const save = () => {
    if (!file) return;
    const content = JSON.stringify(notices) + "\n";
    saving = saving.then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temporary = `${file}.part`;
      await fs.writeFile(temporary, content, { mode: 0o600 });
      await fs.rename(temporary, file);
    }).catch(() => console.error("Conflict guard notifications could not be saved"));
  };
  return {
    add(notice: Omit<GuardNotification, "read" | "handled">) { notices.push(sanitize({ ...notice, read: false, handled: false }, sensitiveValues)); save(); },
    list(memberId?: string) { return notices.filter((notice) => notice.memberId === memberId).map((notice) => ({ ...notice })); },
    update(id: string, memberId: string, state: { read?: boolean; handled?: boolean }) {
      const notice = notices.find((entry) => entry.id === id && entry.memberId === memberId);
      if (!notice) return false;
      if (state.read !== undefined) notice.read = state.read;
      if (state.handled !== undefined) notice.handled = state.handled;
      save(); return true;
    },
    flush: () => saving
  };
}
