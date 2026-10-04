import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
const root=await fs.mkdtemp("/tmp/simplercp-screenshots-");
await fs.mkdir(path.join(root,"home"));
await fs.writeFile(new URL("../results/screenshot-environment.json",import.meta.url),JSON.stringify({dataDir:root,commit:"ba8fa32b38d73d15cfb241ca77bfb926c0231fa0",serverPort:4199,clientPort:5199,startedAt:new Date().toISOString()},null,2)+"\n");
const child=spawn("pnpm",["dev:demo"],{cwd:new URL("../../../",import.meta.url),env:{...process.env,PORT:"4199",VITE_SIMPLERCP_API_ORIGIN:"http://127.0.0.1:4199",VITE_SIMPLERCP_CLIENT_PORT:"5199",SIMPLERCP_PUBLIC_URL:"http://127.0.0.1:5199",SIMPLERCP_DATA_DIR:root,SIMPLERCP_TERMINAL_HOME:path.join(root,"home"),SIMPLERCP_GUARD_MODE:"full",SIMPLERCP_GUARD_LLM_MODE:"suggest",SIMPLERCP_GUARD_APPROVAL_TIMEOUT_MS:"15000",SIMPLERCP_OPENCODE_PORT:"4999",SIMPLERCP_SHELL:"/bin/sh"},stdio:"inherit"});
process.once("SIGINT",()=>child.kill("SIGINT"));process.once("SIGTERM",()=>child.kill("SIGTERM"));child.once("exit",code=>process.exit(code??1));
