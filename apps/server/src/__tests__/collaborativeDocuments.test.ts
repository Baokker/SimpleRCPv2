import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCollaborativeDocumentStore } from "../collaborativeDocuments.js";
import { createTestWorkspace } from "./testWorkspace.js";

let root: string;

beforeEach(async () => {
  root = await createTestWorkspace("collaborative-documents-");
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "hello.ts"), "hello");
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("collaborative document store", () => {
  it("initializes from disk and persists merged Yjs text", async () => {
    const persistedPaths: string[] = [];
    const store = createCollaborativeDocumentStore({
      workspaceRoot: root,
      persistDelayMs: 5,
      onPersisted: (filePath) => persistedPaths.push(filePath)
    });
    const document = await store.getDocument("room-one", "src/hello.ts");
    const text = document.getText("content");

    expect(text.toString()).toBe("hello");

    text.insert(0, "A ");
    text.insert(text.length, " B");
    await store.flush("room-one", "src/hello.ts");

    await expect(
      fs.readFile(path.join(root, "src", "hello.ts"), "utf8")
    ).resolves.toBe("A hello B");
    expect(persistedPaths).toContain("src/hello.ts");
  });

  it("retires an active document before its path is renamed", async () => {
    const store = createCollaborativeDocumentStore({
      workspaceRoot: root,
      persistDelayMs: 5
    });
    const document = await store.getDocument("room-two", "src/hello.ts");
    document.getText("content").insert(5, " world");

    await store.retirePath("src/hello.ts");
    await fs.rename(
      path.join(root, "src", "hello.ts"),
      path.join(root, "src", "greeting.ts")
    );
    await store.flushDocument("room-two:src/hello.ts", document);

    await expect(
      fs.readFile(path.join(root, "src", "greeting.ts"), "utf8")
    ).resolves.toBe("hello world");
    await expect(
      fs.stat(path.join(root, "src", "hello.ts"))
    ).rejects.toThrow();
  });

  it("reloads an active Yjs document after an external disk change", async () => {
    const store = createCollaborativeDocumentStore({ workspaceRoot: root });
    const document = await store.getDocument("room-three", "src/hello.ts");

    await fs.writeFile(path.join(root, "src", "hello.ts"), "external change");
    await store.reloadPath("src/hello.ts");

    expect(document.getText("content").toString()).toBe("external change");
  });

  it("preserves a member edit made while an external change is loading", async () => {
    await fs.writeFile(path.join(root, "src", "hello.ts"), "hello world");
    const store = createCollaborativeDocumentStore({
      workspaceRoot: root,
      persistDelayMs: 60_000
    });
    const document = await store.getDocument("room-four", "src/hello.ts");
    const text = document.getText("content");

    await fs.writeFile(
      path.join(root, "src", "hello.ts"),
      "hello brave world"
    );
    const reload = store.reloadPath("src/hello.ts");
    text.insert(text.length, "!");
    await reload;
    await store.flush("room-four", "src/hello.ts");

    expect(text.toString()).toBe("hello brave world!");
    await expect(
      fs.readFile(path.join(root, "src", "hello.ts"), "utf8")
    ).resolves.toBe("hello brave world!");
  });

  it("persists pending member changes before awaitIdle resolves", async () => {
    const store = createCollaborativeDocumentStore({
      workspaceRoot: root,
      persistDelayMs: 60_000
    });
    const document = await store.getDocument("room-five", "src/hello.ts");

    document.getText("content").insert(5, " world");
    await store.awaitIdle();

    await expect(
      fs.readFile(path.join(root, "src", "hello.ts"), "utf8")
    ).resolves.toBe("hello world");
  });

  it("increments a file revision for member edits and ignores external reloads", async () => {
    const store = createCollaborativeDocumentStore({ workspaceRoot: root });
    const document = await store.getDocument("room-revision", "src/hello.ts");

    expect(store.getRevision("src/hello.ts")).toBe(0);
    document.getText("content").insert(5, " member");
    expect(store.getRevision("src/hello.ts")).toBe(1);

    await fs.writeFile(path.join(root, "src", "hello.ts"), "external change");
    await store.reloadPath("src/hello.ts");
    expect(store.getRevision("src/hello.ts")).toBe(1);
  });

  it("does not count a guard revert as a member revision", async () => {
    await fs.writeFile(path.join(root, "src", "hello.ts"), "agent text");
    const store = createCollaborativeDocumentStore({ workspaceRoot: root, persistDelayMs: 1 });
    const document = await store.getDocument("room", "src/hello.ts");

    await store.applyGuardRevert("src/hello.ts", "agent text", "original text", "member-1");

    expect(document.getText("content").toString()).toBe("original text");
    expect(store.getRevision("src/hello.ts")).toBe(0);
    await expect(fs.readFile(path.join(root, "src", "hello.ts"), "utf8")).resolves.toBe("original text");
    await store.dispose();
  });

  it("retires an active document when its file becomes binary", async () => {
    const store = createCollaborativeDocumentStore({
      workspaceRoot: root,
      persistDelayMs: 60_000
    });
    const document = await store.getDocument("room-six", "src/hello.ts");
    document.getText("content").insert(5, " pending");

    await fs.writeFile(
      path.join(root, "src", "hello.ts"),
      Buffer.from([1, 0, 2, 3])
    );
    await store.reloadPath("src/hello.ts");
    await store.awaitIdle();

    await expect(
      store.getDocument("room-six", "src/hello.ts")
    ).rejects.toThrow("Collaborative document path is no longer active");
    await expect(
      fs.readFile(path.join(root, "src", "hello.ts"))
    ).resolves.toEqual(Buffer.from([1, 0, 2, 3]));
  });

  it("保留闸门锁定期间的文档并在解除后释放", async () => {
    let pinned = true;
    const released: string[] = [];
    const store = createCollaborativeDocumentStore({
      workspaceRoot: root,
      persistDelayMs: 300,
      shouldPinDocument: () => pinned,
      onDocumentReleased: (file) => released.push(file)
    });
    const document = await store.getDocument("room-pinned", "src/hello.ts");
    const name = "room-pinned:src/hello.ts";
    expect(store.release(name)).toBe(false);
    expect(await store.getDocument("room-pinned", "src/hello.ts")).toBe(document);
    const pending = store.waitForRelease(name, document);
    pinned = false;
    store.releaseUnpinned();
    await pending;
    expect(released).toEqual(["src/hello.ts"]);
  });
});
