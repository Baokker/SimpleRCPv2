import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import WebSocket from "../../../apps/server/node_modules/ws/index.js";
import { createApp } from "../../../apps/server/src/createApp.js";
import { attachRealtimeServer } from "../../../apps/server/src/realtime.js";
import { createSnapshotStore } from "../../../apps/server/src/guard/snapshots.js";
import { mean, percentile, standardDeviation } from "../lib/common.js";

export const stats = (values: number[]) => ({ sampleSize: values.length, meanMs: mean(values), standardDeviationMs: standardDeviation(values), p50Ms: percentile(values,0.5), p95Ms: percentile(values,0.95), p99Ms: percentile(values,0.99) });
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve,ms));
export async function serviceMeasurements(root: string) {
  const raw: any[] = [];
  const results: any = {};
  for (const mode of ["off","full"] as const) {
    const dataDir=path.join(root,mode,"data"), seed=path.join(root,mode,"seed");
    await fs.mkdir(seed,{recursive:true}); await fs.writeFile(path.join(seed,"README.md"),"benchmark\n");
    const app=await createApp({port:0,host:"127.0.0.1",publicOrigin:"http://127.0.0.1",dataDir,demoProjectRoot:seed,guardMode:mode,guardLlmMode:"off"});
    const server=http.createServer(app), realtime=attachRealtimeServer(server,app.locals.runtimeManager,app.locals.agentRuns,{members:app.locals.members});
    await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
    const address=server.address(); if(!address||typeof address==="string")throw new Error("Server address missing");
    const runtime=app.locals.runtimeManager.get("demo"), writes=new Map<string,bigint>();
    const originalWrite=runtime.terminal.write.bind(runtime.terminal);
    runtime.terminal.write=(data:string,memberId:string,audit:boolean)=>{writes.set(data.trim(),process.hrtime.bigint());return originalWrite(data,memberId,audit);};
    const sockets: any[]=[];
    for(let index=0;index<20;index++){
      const member=await app.locals.members.join("demo",{displayName:"benchmark-"+index,role:"collaborator"});
      runtime.rooms.joinRoom(runtime.room.id,{memberId:member.memberId,name:"benchmark-"+index,participantId:member.memberId,connectionId:member.memberId,profileRole:"collaborator"});
      const socket=new WebSocket(`ws://127.0.0.1:${address.port}/terminal?projectId=demo&memberId=${member.memberId}`);
      await new Promise<void>((resolve,reject)=>{socket.once("open",resolve);socket.once("error",reject);}); sockets.push(socket);
    }
    await delay(300);
    let serial=0;
    async function send(socket:any, measured:boolean, family:string, members:number){
      const command="echo benchmark-"+(serial++), start=process.hrtime.bigint();
      const received=new Promise<any>((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error("Terminal reply timeout")),10000);
        const listener=(buffer:Buffer)=>{const message=JSON.parse(buffer.toString());if(message.type!=="guard_decision"||message.command!==command)return;clearTimeout(timer);socket.off("message",listener);resolve(message);}; socket.on("message",listener);
      });
      socket.send(JSON.stringify({type:"command",text:command}));
      const reply=await received, written=writes.get(command), end=process.hrtime.bigint();
      const row={id:`${mode}-${serial}`,family,condition:mode,members,command,action:reply.action,outcome:reply.outcome,accepted:Boolean(written),durationMs:written?Number(written-start)/1e6:null,responseMs:Number(end-start)/1e6};
      if(measured)raw.push(row);
      return row;
    }
    for(let index=0;index<100;index++)await send(sockets[0],false,"endpoint",1);
    const endpoint=[];for(let index=0;index<1000;index++)endpoint.push(await send(sockets[0],true,"endpoint",1));
    results[mode]={endpoint:stats(endpoint.filter(r=>r.accepted).map(r=>r.durationMs)),endpointRejected:endpoint.filter(r=>!r.accepted).length,concurrency:[],agentService:null};
    if(mode==="full"){
      const member=runtime.room.members[0].id, values=[];
      for(let index=0;index<1100;index++){
        const started=process.hrtime.bigint(); const result=await runtime.guard.submit({projectId:"demo",memberId:member,source:"agent",agentRunId:"benchmark",kind:"command",command:"git status",cwd:runtime.project.workspacePath});
        if(!result.approved)throw new Error("Agent benchmark unexpectedly required approval");
        const durationMs=Number(process.hrtime.bigint()-started)/1e6;
        if(index>=100){values.push(durationMs);raw.push({id:"agent-service-"+index,family:"agent-service",condition:mode,durationMs});}
      }
      results[mode].agentService=stats(values);
    }
    for(const members of [2,5,10,20]){
      const group=[],started=process.hrtime.bigint();
      for(let index=0;index<1000;index+=members)group.push(...await Promise.all(sockets.slice(0,Math.min(members,1000-index)).map(s=>send(s,true,"concurrency",members))));
      const elapsedMs=Number(process.hrtime.bigint()-started)/1e6,accepted=group.filter(r=>r.accepted);
      results[mode].concurrency.push({members,...stats(accepted.map(r=>r.durationMs)),requests:group.length,rejected:group.length-accepted.length,elapsedMs,throughputPerSecond:accepted.length/elapsedMs*1000});
    }
    await runtime.guard.awaitIdle();
    await delay(1000);
    for(const socket of sockets)socket.terminate(); realtime.dispose();
    for(const wss of [realtime.presence,realtime.documents,realtime.terminal])wss.close();
    await app.locals.agentRuns.dispose();await app.locals.agentRuntime.dispose();await app.locals.runtimeManager.dispose();
    await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
  }
  const off=raw.filter(r=>r.family==="endpoint"&&r.condition==="off"&&r.accepted),full=raw.filter(r=>r.family==="endpoint"&&r.condition==="full"&&r.accepted);
  results.incremental=stats(full.slice(0,Math.min(off.length,full.length)).map((r,i)=>r.durationMs-off[i].durationMs));
  return {raw,results};
}
export async function snapshotMeasurements(root:string){
  const points:any[]=[],raw:any[]=[];
  for(const [sizeMB,fileCount]of [[1,100],[10,1000],[100,5000],[500,20000]]){
    const workspace=path.join(root,`snapshot-${sizeMB}`),metadata=path.join(root,`snapshot-metadata-${sizeMB}`);
    await fs.mkdir(workspace,{recursive:true});
    const bytes=Buffer.alloc(Math.floor(sizeMB*1024*1024/fileCount),7);
    for(let offset=0;offset<fileCount;offset+=100)await Promise.all(Array.from({length:Math.min(100,fileCount-offset)},(_,i)=>fs.writeFile(path.join(workspace,`file-${offset+i}.bin`),bytes)));
    const store=createSnapshotStore(metadata,workspace),values=[];
    for(let repeat=0;repeat<5;repeat++){
      const start=process.hrtime.bigint(),manifest=await store.create({memberId:"benchmark"}),durationMs=Number(process.hrtime.bigint()-start)/1e6;
      if(manifest.files.length!==fileCount)throw new Error("Snapshot file count mismatch");
      values.push(durationMs);raw.push({id:`snapshot-${sizeMB}-${repeat}`,family:"snapshot",sizeMB,fileCount,repeat,durationMs});
      await fs.rm(path.join(metadata,"snapshots",manifest.id),{recursive:true});
    }
    points.push({sizeMB,fileCount,repeats:5,...stats(values)});await fs.rm(workspace,{recursive:true});
  }
  return {points,raw};
}
