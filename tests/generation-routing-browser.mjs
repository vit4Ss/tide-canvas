import assert from "node:assert/strict";
import {createServer} from "node:http";
import {spawn} from "node:child_process";
import {chromium} from "playwright-core";

// Isolated production app: no real backend, real keys, paid requests or flaky
// third-party resources. Verify both generation entry points and task following.
const calls=[];
let reject=true;
const user={id:"42",username:"creator",nickname:"Creator",points:100,role:0};
const model={id:"image-row",modelKey:"image-test",modelId:"image-test",name:"Image Test",type:"image",pointCost:"4",config:{modes:["t2i"],resolutions:["1k"],ratios:["1:1"],batchOptions:[1]}};
const task={id:"123456",handler:"text_to_image",modelName:"Image Test",status:1,progress:100,pointCost:4,resultUrl:"http://127.0.0.1:3212/art/architecture.jpg",input:{prompt:"A mountain"},createTime:"2026-10-14T00:00:00Z"};
const rejected="The safety check could not be completed. No generation credits were charged.";
const fixture=createServer((req,res)=>{
 const path=new URL(req.url,"http://fixture.test").pathname;
 let data={};
 if(req.method==="POST")calls.push(path);
 if(path==="/api/auth/me")data=user;
 else if(path==="/api/auth/register-config")data={registerClosed:false};
 else if(path==="/api/auth/api-key")data={revision:1,enabled:true,hint:"fixture"};
 else if(path==="/api/auth/api-key/reveal")data={key:"tc_sk_fixture",revision:1};
 else if(path==="/api/market/studio-models"||path==="/api/en/open/v1/models")data=[model];
 else if(path==="/api/billing/en/plans"||path==="/api/billing/en/channels")data=[];
 else if(path==="/api/billing/en/consumer")data={supportEmail:"support@example.test"};
 else if(path==="/api/en/ai/safety-config")data={promptScreening:true,outputScreening:false};
 else if(path==="/api/en/ai/generate"||path==="/api/en/open/v1/generations"){
  if(reject){res.writeHead(400,{"Content-Type":"application/json"});res.end(JSON.stringify({success:false,code:400,message:rejected,data:null}));return;}
  data=path.includes("/open/")?{...task,status:0}:task;
 }else if(path.startsWith("/api/en/open/v1/tasks/"))data=task;
 else if(path==="/api/ai/tasks"||path==="/api/ai/history"||path==="/api/files")data={records:[],total:0};
 res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify({success:true,code:200,data}));
});
await new Promise(resolve=>fixture.listen(0,"127.0.0.1",resolve));
const base="http://127.0.0.1:3212";
const app=spawn(process.execPath,["node_modules/next/dist/bin/next","start","-H","127.0.0.1","-p","3212"],{env:{...process.env,NODE_ENV:"production",APP_ENV:"test",BACKEND_URL:`http://127.0.0.1:${fixture.address().port}`,SITE_URL:base,GOOGLE_CLIENT_ID:""},windowsHide:true,stdio:["ignore","pipe","pipe"]});
let output="";app.stdout.on("data",data=>output+=data);app.stderr.on("data",data=>output+=data);
let browser, page;
try{
 let ready=false;
 for(let i=0;i<60;i++){if(app.exitCode!==null)throw new Error(output);try{if((await fetch(base+"/healthz",{signal:AbortSignal.timeout(1500)})).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,250));}
 assert.ok(ready,"App did not start");
 browser=await chromium.launch({headless:true,...(process.platform==="win32"?{executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"}:{channel:"chrome"})});
 const context=await browser.newContext();await context.addInitScript(()=>{localStorage.setItem("access_token","fixture-jwt");localStorage.setItem("refresh_token","fixture-refresh");});
 page=await context.newPage();const errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.goto(base+"/studio",{waitUntil:"networkidle"});
 await page.getByLabel("Your prompt",{exact:true}).fill("A mountain");
 await page.getByRole("button",{name:"Generate",exact:true}).click();await page.getByText(rejected,{exact:true}).waitFor();
 assert.ok(calls.includes("/api/en/ai/generate"));
 assert.ok(!calls.includes("/api/ai/generate"),"Safety error fell back to the CN generation route");
 reject=false;
 await page.getByRole("button",{name:"Generate",exact:true}).click();await page.locator(".task-image").first().waitFor();
 await page.goto(base+"/playground",{waitUntil:"networkidle"});
 await page.getByRole("button",{name:"Use account key"}).click();
 await page.getByRole("button",{name:"Load models",exact:true}).click();
 await page.getByRole("combobox",{name:"Endpoint",exact:true}).click();await page.getByRole("option",{name:"Create a generation",exact:true}).click();
 await page.getByRole("button",{name:"Run request",exact:true}).click();
 await page.waitForFunction(()=>document.querySelector(".response-code")?.textContent.includes('"status": 1'));
 assert.ok(calls.includes("/api/en/open/v1/generations"));
 assert.ok(!calls.includes("/api/open/v1/generations"));
 await page.goto(base+"/docs",{waitUntil:"domcontentloaded"});assert.match(await page.locator("body").innerText(),/\/api\/en\/open\/v1\/generations/);
 assert.deepEqual(errors,[]);
 console.log("Generation isolation passed: EN Studio and API use dedicated routes, failure has no CN fallback, success/owned-task following and docs use the new namespace.");
}catch(error){
 console.log(JSON.stringify({calls,visible:page?await page.locator("body").innerText().catch(()=>""):"",app:output.slice(-1500)}));throw error;
}finally{
 await browser?.close();app.kill();await Promise.race([new Promise(resolve=>app.once("exit",resolve)),new Promise(resolve=>setTimeout(resolve,3000))]);fixture.closeAllConnections();await new Promise(resolve=>fixture.close(resolve));
}
