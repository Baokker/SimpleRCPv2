import fs from "node:fs/promises";
import path from "node:path";
import { createApp } from "../../../apps/server/src/createApp.js";
import { createTestAgentRuntime } from "../../../apps/server/src/agent/fakeAgentRuntime.js";
import type { AgentRuntime } from "../../../apps/server/src/agent/agentRuntime.js";

const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const events=["cancel","timeout","404","duplicate","v1-v2","owner-online","owner-offline","subagent"];
function controlledRuntime(){
  const listeners=new Map<string,any>(),waiters=new Map<string,(reply:string)=>void>(),replies=new Map<string,number>();let serial=0;
  const api:AgentRuntime={
    async status(){return {runtime:"opencode",state:"ready",version:"fault-runtime",model:"controlled",apiKeyConfigured:true};},
    async createSession(){return {id:"controlled-"+(serial++)};},
    async run(input){
      const event=input.prompt.match(/scenario=(\S+)/)![1],id="permission-"+input.sessionId;
      if(event==="404")listeners.set("event-"+id,"404");
      const resolveReply=new Promise<string>(resolve=>waiters.set(id,resolve));
      const data={id,permission:"bash",sessionID:event==="subagent"?"child-session":input.sessionId,metadata:{command:"rm peer.txt"}};
      await delay(1); await listeners.get(input.sessionId)?.({type:"permission.asked",data});
      if(event==="duplicate"||event==="v1-v2")await listeners.get(input.sessionId)?.({type:event==="v1-v2"?"permission.v2.asked":"permission.asked",data});
      if(event==="subagent"){waiters.delete(id);return {text:"subagent event emitted"};}
      const reply=await resolveReply;waiters.delete(id);
      if(reply!=="once")throw new Error("Controlled permission rejected");return {text:"approved"};
    },
    async getDiff(){return [];},
    async replyPermission(input){
      replies.set(input.requestId,(replies.get(input.requestId)??0)+1);waiters.get(input.requestId)?.(input.reply);
      if(listeners.get("event-"+input.requestId)==="404")throw new Error("Permission endpoint returned 404");
    },
    async cancel(input){waiters.get("permission-"+input.sessionId)?.("reject");},
    async subscribe(input,listener){listeners.set(input.sessionId,listener);return async()=>{listeners.delete(input.sessionId);};},
    async dispose(){for(const resolve of waiters.values())resolve("reject");waiters.clear();listeners.clear();}
  };
  return {api,replies,set404(id:string){listeners.set("event-permission-"+id,"404");}};
}
export async function runtimeFaults(directory:string){
  const projectRoot=path.resolve(new URL("../../..", import.meta.url).pathname);
  await fs.mkdir(path.join(projectRoot, ".experiment-data"), { recursive: true });
  const root=await fs.mkdtemp(path.join(projectRoot, ".experiment-data", "x6-")),seed=path.join(root,"seed"),dataDir=path.join(root,"data");
  process.env.SIMPLERCP_DATA_DIR=dataDir;process.env.SIMPLERCP_TERMINAL_HOME=path.join(root,"home");
  await fs.mkdir(seed,{recursive:true});await fs.mkdir(process.env.SIMPLERCP_TERMINAL_HOME,{recursive:true});await fs.writeFile(path.join(seed,"peer.txt"),"peer\n");
  const app=await createApp({port:0,host:"127.0.0.1",publicOrigin:"http://127.0.0.1",dataDir,demoProjectRoot:seed,guardMode:"full",guardLlmMode:"off",guardApprovalTimeoutMs:30,fakeAgentRuntime:true,agent:{model:"controlled",openCodePort:49000,runTimeoutMs:2000}});
  const real={...app.locals.agentRuntime},controlled=controlledRuntime();Object.assign(app.locals.agentRuntime,createTestAgentRuntime(real,controlled.api,false));
  const runtime=app.locals.runtimeManager.get("demo");
  const actor=(await app.locals.members.join("demo",{displayName:"Student",role:"student"})).memberId;
  const owner=(await app.locals.members.join("demo",{displayName:"Owner",role:"owner"})).memberId;
  const online=(id:string,role:string)=>runtime.rooms.joinRoom(runtime.room.id,{memberId:id,name:role,participantId:id,connectionId:id,profileRole:role});online(actor,"student");online(owner,"owner");
  const rows:any[]=[],operations:Promise<any>[]=[];let activeEvent="",activeRunId="";
  const remove=runtime.guard.onPending((pending:any)=>{
    operations.push((async()=>{
      if(activeEvent==="timeout")return;
      if(activeEvent==="cancel"){await app.locals.agentRuns.cancelRun("demo",pending.request.agentRunId,actor);return;}
      if(activeEvent==="owner-online")online(owner,"owner");
      if(activeEvent==="owner-offline")runtime.rooms.markOffline(runtime.room.id,owner);
      await runtime.guard.approve(pending.id,owner);
    })());
  });
  let state=0xbb67ae85;
  for(let index=0;index<500;index++){
    state=(Math.imul(state,1664525)+1013904223)>>>0;activeEvent=events[Math.floor(state/2**32*events.length)];online(owner,"owner");
    if(activeEvent==="owner-online")runtime.rooms.markOffline(runtime.room.id,owner);
    const session=await app.locals.agentRuns.createSession({projectId:"demo",memberId:actor,title:"fake-permission=experiment"});
    let run=await app.locals.agentRuns.createRun({projectId:"demo",memberId:actor,sessionId:session.id,prompt:"fake-permission=experiment scenario="+activeEvent,source:"agent-panel"});activeRunId=run.id;
    const deadline=Date.now()+3000;
    while(!["completed","failed","cancelled"].includes(run.status)&&Date.now()<deadline){await delay(5);run=await app.locals.agentRuns.getRun("demo",run.id);}
    await Promise.all(operations);operations.length=0;
    const trace=await app.locals.agentRuns.listTrace("demo",run.id),asked=trace.find((e:any)=>e.type==="opencode.permission.asked");
    const count=controlled.replies.get(asked?.data?.id)??0,expected=activeEvent==="cancel"?"cancelled":["timeout","owner-offline"].includes(activeEvent)?"failed":"completed";
    const hung=!["completed","failed","cancelled"].includes(run.status),incorrect=run.status!==expected,duplicate=count>1,pending=runtime.guard.pending().filter((p:any)=>p.request.agentRunId===run.id).length;
    const tracePath=path.join(directory,"traces",`fault-${index}.jsonl`);await fs.mkdir(path.dirname(tracePath),{recursive:true});await fs.writeFile(tracePath,trace.map((e:any)=>JSON.stringify(e)).join("\n")+"\n");
    rows.push({id:"fault-"+index,family:activeEvent,dataset:"X6",status:run.status,expectedStatus:expected,replyCount:count,pending,hung,incorrect,duplicate,tracePath,durationMs:0});
    if(hung)await app.locals.agentRuns.cancelRun("demo",run.id,actor);
    if((index+1)%50===0)process.stderr.write(`X6 ${index+1}/500\n`);
  }
  remove();await runtime.guard.awaitIdle();
  const revocations:any[]=[];
  for(const event of ["downgrade","offline","team-interrupted"]){
    await app.locals.members.join("demo",{memberId:actor,displayName:"Student",role:"student"});online(actor,"student");online(owner,"owner");
    const id="revocation-"+event,request={projectId:"demo",memberId:actor,source:"agent" as const,agentRunId:id,sessionScope:"team" as const,kind:"command" as const,command:"rm peer.txt",cwd:runtime.project.workspacePath};
    const before=await runtime.guard.decide(request),promise=runtime.guard.submit(request);await delay(5);const pending=runtime.guard.pending().find((p:any)=>p.request.agentRunId===id);
    if(!pending)throw new Error("Revocation approval absent");
    const eventAt=new Date().toISOString();
    if(event==="downgrade")await app.locals.members.join("demo",{memberId:actor,displayName:"Student",role:"observer"});
    if(event==="offline")runtime.rooms.markOffline(runtime.room.id,actor);
    if(event==="team-interrupted")runtime.guard.cancelRun(id);
    else await runtime.guard.approve(pending.id,owner);
    const result=await promise,next=await runtime.guard.submit(request);
    revocations.push({id,eventAt,before:before.action,pendingOutcome:result.decision.outcome,approved:result.approved,nextAction:next.decision.action,nextApproved:next.approved,toolCallAfterEvent:1});
  }
  await app.locals.agentRuns.dispose();await app.locals.agentRuntime.dispose();await app.locals.runtimeManager.dispose();
  return {rows,revocations,root,summary:{cases:rows.length,hung:rows.filter(r=>r.hung).length,duplicateReplies:rows.filter(r=>r.duplicate).length,incorrectOutcomes:rows.filter(r=>r.incorrect).length,pendingAtEnd:rows.filter(r=>r.pending>0).length}};
}
