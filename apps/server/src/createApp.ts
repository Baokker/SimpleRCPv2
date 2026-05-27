import cors from "cors";
import express from "express";
import type { ServerConfig } from "./config.js";

export function createApp(config: ServerConfig) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      workspaceRoot: config.workspaceRoot
    });
  });

  return app;
}
