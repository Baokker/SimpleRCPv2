import type { Express } from "express";
import type { ProjectRuntime } from "../projectRuntime.js";
import type { ProjectRuntimeManager } from "../projectRuntimeManager.js";
import {
  createWorkspaceDirectory,
  createWorkspaceFile,
  deleteWorkspacePath,
  listWorkspaceDirectory,
  readWorkspaceFile,
  renameWorkspacePath,
  writeWorkspaceFile
} from "../workspace.js";

export function registerWorkspaceRoutes(
  app: Express,
  runtimeManager: ProjectRuntimeManager
) {
  app.get("/api/projects/:projectId/workspace/directory", async (req, res, next) => {
    try {
      const runtime = runtimeManager.get(req.params.projectId);
      const directoryPath = String(req.query.path ?? "");
      res.json({
        tree: await listWorkspaceDirectory(
          runtime.project.workspacePath,
          directoryPath
        )
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/projects/:projectId/workspace/file", async (req, res, next) => {
    try {
      const runtime = runtimeManager.get(req.params.projectId);
      const filePath = String(req.query.path ?? "");
      const force = req.query.force === "true";
      res.json(
        await readWorkspaceFile(runtime.project.workspacePath, filePath, force)
      );
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/projects/:projectId/workspace/file", async (req, res, next) => {
    try {
      const runtime = runtimeManager.get(req.params.projectId);
      const { path: filePath, content, initiatorId } = req.body as {
        path?: string;
        content?: string;
        initiatorId?: string;
      };
      if (!filePath || typeof content !== "string" || !initiatorId) {
        res.status(400).json({ error: "path, content, and initiatorId are required" });
        return;
      }
      requireMember(runtime, initiatorId);
      await writeWorkspaceFile(runtime.project.workspacePath, filePath, content);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:projectId/workspace/file", async (req, res, next) => {
    try {
      const runtime = runtimeManager.get(req.params.projectId);
      const { path: filePath, content, initiatorId } = req.body as {
        path?: string;
        content?: string;
        initiatorId?: string;
      };
      if (!filePath || !initiatorId) {
        res.status(400).json({ error: "path and initiatorId are required" });
        return;
      }
      const member = requireMember(runtime, initiatorId);
      runtime.suppressWorkspaceChange({ type: "add", path: filePath });
      await createWorkspaceFile(
        runtime.project.workspacePath,
        filePath,
        content ?? ""
      );
      runtime.events.append({
        type: "workspace_file_created",
        roomId: runtime.room.id,
        memberId: initiatorId,
        participantId: member.participantId,
        payload: { path: filePath, name: member.displayName }
      });
      runtime.announceWorkspaceChange({ type: "add", path: filePath });
      res.json({
        tree: await listWorkspaceDirectory(runtime.project.workspacePath, "")
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:projectId/workspace/directory", async (req, res, next) => {
    try {
      const runtime = runtimeManager.get(req.params.projectId);
      const { path: directoryPath, initiatorId } = req.body as {
        path?: string;
        initiatorId?: string;
      };
      if (!directoryPath || !initiatorId) {
        res.status(400).json({ error: "path and initiatorId are required" });
        return;
      }
      const member = requireMember(runtime, initiatorId);
      runtime.suppressWorkspaceChange({ type: "addDir", path: directoryPath });
      await createWorkspaceDirectory(runtime.project.workspacePath, directoryPath);
      runtime.events.append({
        type: "workspace_directory_created",
        roomId: runtime.room.id,
        memberId: initiatorId,
        participantId: member.participantId,
        payload: { path: directoryPath, name: member.displayName }
      });
      runtime.announceWorkspaceChange({ type: "addDir", path: directoryPath });
      res.json({
        tree: await listWorkspaceDirectory(runtime.project.workspacePath, "")
      });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/projects/:projectId/workspace/path", async (req, res, next) => {
    try {
      const runtime = runtimeManager.get(req.params.projectId);
      const { fromPath, toPath, initiatorId } = req.body as {
        fromPath?: string;
        toPath?: string;
        initiatorId?: string;
      };
      if (!fromPath || !toPath || !initiatorId) {
        res.status(400).json({
          error: "fromPath, toPath, and initiatorId are required"
        });
        return;
      }
      const member = requireMember(runtime, initiatorId);
      runtime.suppressWorkspaceChange({
        type: "rename",
        fromPath,
        path: toPath
      });
      await runtime.documents.retirePath(fromPath);
      await renameWorkspacePath(runtime.project.workspacePath, fromPath, toPath);
      runtime.events.append({
        type: "workspace_path_renamed",
        roomId: runtime.room.id,
        memberId: initiatorId,
        participantId: member.participantId,
        payload: { fromPath, toPath, name: member.displayName }
      });
      runtime.announceWorkspaceChange({
        type: "rename",
        fromPath,
        path: toPath
      });
      res.json({
        tree: await listWorkspaceDirectory(runtime.project.workspacePath, "")
      });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/projects/:projectId/workspace/path", async (req, res, next) => {
    try {
      const runtime = runtimeManager.get(req.params.projectId);
      const workspacePath = String(req.query.path ?? "");
      const initiatorId = String(req.query.initiatorId ?? "");
      if (!workspacePath || !initiatorId) {
        res.status(400).json({ error: "path and initiatorId are required" });
        return;
      }
      const member = requireMember(runtime, initiatorId);
      runtime.suppressWorkspaceChange({ type: "unlink", path: workspacePath });
      await runtime.documents.retirePath(workspacePath);
      await deleteWorkspacePath(runtime.project.workspacePath, workspacePath);
      runtime.events.append({
        type: "workspace_path_deleted",
        roomId: runtime.room.id,
        memberId: initiatorId,
        participantId: member.participantId,
        payload: { path: workspacePath, name: member.displayName }
      });
      runtime.announceWorkspaceChange({ type: "unlink", path: workspacePath });
      res.json({
        tree: await listWorkspaceDirectory(runtime.project.workspacePath, "")
      });
    } catch (error) {
      next(error);
    }
  });
}

function requireMember(runtime: ProjectRuntime, memberId: string) {
  const member = runtime.rooms.getMember(runtime.room.id, memberId);
  if (!member) throw new Error("Project membership is required");
  return member;
}
