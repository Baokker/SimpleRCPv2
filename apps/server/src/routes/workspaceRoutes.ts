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
import { requireIdentity, requirePermission } from "../auth/permissions.js";

export function registerWorkspaceRoutes(
  app: Express,
  runtimeManager: ProjectRuntimeManager
) {
  app.get("/api/projects/:projectId/workspace/directory", async (req, res, next) => {
    try {
      if (!requireIdentity(req, res)) return;
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
      if (!requireIdentity(req, res)) return;
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
      if (!requirePermission(req, res, "workspace:write")) return;
      const runtime = runtimeManager.get(req.params.projectId);
      const { path: filePath, content } = req.body as {
        path?: string;
        content?: string;
      };
      if (!filePath || typeof content !== "string") {
        res.status(400).json({ error: "path and content are required" });
        return;
      }
      requireMember(runtime, req.identity?.memberId ?? "");
      await writeWorkspaceFile(runtime.project.workspacePath, filePath, content);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:projectId/workspace/file", async (req, res, next) => {
    try {
      if (!requirePermission(req, res, "workspace:write")) return;
      const runtime = runtimeManager.get(req.params.projectId);
      const { path: filePath, content } = req.body as {
        path?: string;
        content?: string;
      };
      if (!filePath) {
        res.status(400).json({ error: "path is required" });
        return;
      }
      const member = requireMember(runtime, req.identity?.memberId ?? "");
      const initiatorId = member.id;
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
      if (!requirePermission(req, res, "workspace:write")) return;
      const runtime = runtimeManager.get(req.params.projectId);
      const { path: directoryPath } = req.body as {
        path?: string;
      };
      if (!directoryPath) {
        res.status(400).json({ error: "path is required" });
        return;
      }
      const member = requireMember(runtime, req.identity?.memberId ?? "");
      const initiatorId = member.id;
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
      if (!requirePermission(req, res, "workspace:write")) return;
      const runtime = runtimeManager.get(req.params.projectId);
      const { fromPath, toPath } = req.body as {
        fromPath?: string;
        toPath?: string;
      };
      if (!fromPath || !toPath) {
        res.status(400).json({
          error: "fromPath and toPath are required"
        });
        return;
      }
      const member = requireMember(runtime, req.identity?.memberId ?? "");
      const initiatorId = member.id;
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
      if (!requirePermission(req, res, "workspace:write")) return;
      const runtime = runtimeManager.get(req.params.projectId);
      const workspacePath = String(req.query.path ?? "");
      if (!workspacePath) {
        res.status(400).json({ error: "path is required" });
        return;
      }
      const member = requireMember(runtime, req.identity?.memberId ?? "");
      const initiatorId = member.id;
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
