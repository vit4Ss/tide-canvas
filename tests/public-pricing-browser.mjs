import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

// Isolated public API fixture exercises server rendering as well as hydration.
// It never writes to a real backend or changes the developer's running server.
let state = "published";
const plan = { id:"review-plan", market:"en", currency:"USD", name:"Creator", desc:"A one-time credit pack", monthly:10, yearly:0, monthlyPoints:600, featured:true, items:["Image, video, audio and 3D creation"], vipLevel:0 };
const fixture = createServer((req,res)=>{
 const path=new URL(req.url,"http://fixture.test").pathname;
 let data={};
 if (path==="/api/billing/en/plans") {
  if(state==="failed") {res.writeHead(503);res.end();return;}
  data=state==="empty"?[]:[{...plan,monthly:state==="changed"?15:10,yearly:state==="larger"?100:0}];
 } else if(path==="/api/billing/en/channels") data=[];
 else if(path==="/api/billing/en/consumer") data={supportEmail:"support@example.test",creditValidity:"Fixture credit validity",membershipTerms:"Fixture account benefits",commercialUse:"Check the selected model terms."};
 else if(path==="/api/en/ai/safety-config") data={promptScreening:true,outputScreening:false};
 else if(path==="/api/market/studio-models") data=[{id:"image",name:"Example Image",modelKey:"example-image",type:"image",pointCost:"4",config:{resolutions:["2k"],qualities:["high"],priceMatrix:{high:{"2k":8}}}},{id:"text",name:"Hidden text model",modelKey:"text",type:"text",pointCost:"1"}];
 else if(path==="/api/billing/en/faq") data={items:[]};
 else if(path==="/api/billing/en/compare") data={rows:[]};
 else if(path==="/api/billing/en/promo") data={enabled:false};
 else if(path==="/api/auth/register-config") data={registerClosed:false};
 res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify({success:true,code:200,data}));
});
await new Promise(resolve=>fixture.listen(0,"127.0.0.1",resolve));
const port=Number(process.env.PRICING_TEST_PORT||3211),base=`http://127.0.0.1:${port}`;
const app=spawn(process.execPath,["node_modules/next/dist/bin/next","start","-H","127.0.0.1","-p",String(port)],{env:{...process.env,NODE_ENV:"production",APP_ENV:"test",BACKEND_URL:`http://127.0.0.1:${fixture.address().port}`,SITE_URL:base,GOOGLE_CLIENT_ID:""},windowsHide:true,stdio:["ignore","pipe","pipe"]});
let output="";app.stdout.on("data",data=>output+=data);app.stderr.on("data",data=>output+=data);
let browser;
try {
 let ready=false;
 for(let i=0;i<60;i++) {if(app.exitCode!==null)throw new Error(output);try{if((await fetch(base+"/pricing")).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}
 assert.ok(ready,"Isolated app did not start");
 browser=await chromium.launch({headless:true,...(process.platform==="win32"?{executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"}:{channel:"chrome"})});
 const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:1440,height:1000}});
 const page=await context.newPage();
 await page.goto(base+"/pricing",{waitUntil:"domcontentloaded"});
 assert.match(await page.locator(".plan-price").innerText(),/\$10/);
 assert.match(await page.locator(".plan-credit").innerText(),/600/);
 assert.equal(await page.getByRole("button",{name:"12× credits",exact:true}).count(),0);
 assert.match(await page.locator("body").innerText(),/No subscription or automatic renewal/);
 assert.equal(await page.getByText("Finding your plans…").count(),0);
 assert.equal(await page.getByText("Checking published details…",{exact:true}).count(),0);
 assert.match(await page.locator(".pricing-examples").innerText(),/Example Image[\s\S]*2k[\s\S]*8 credits/);
 assert.equal(await page.getByText("Hidden text model").count(),0);
 const dir=".impeccable/review/public-pricing";await mkdir(dir,{recursive:true});
 await page.screenshot({path:dir+"/desktop.png",fullPage:true});
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:dir+"/mobile.png",fullPage:true});
 state="changed";await page.reload({waitUntil:"domcontentloaded"});assert.match(await page.locator(".plan-price").innerText(),/\$15/);
 state="empty";await page.reload({waitUntil:"domcontentloaded"});assert.equal(await page.locator(".pricing-card").count(),0);await page.getByRole("heading",{name:"Credit packs are not on sale yet."}).waitFor();
 state="failed";await page.reload({waitUntil:"domcontentloaded"});assert.match(await page.getByRole("alert").innerText(),/could not be loaded/);assert.equal(await page.getByRole("heading",{name:"Credit packs are not on sale yet."}).count(),0);
 await page.goto(base+"/aup",{waitUntil:"domcontentloaded"});assert.match(await page.locator("article").innerText(),/Server-side prompt screening is enabled/);assert.match(await page.locator("article").innerText(),/independent review[\s\S]*not yet implemented/);
 await page.goto(base+"/privacy",{waitUntil:"domcontentloaded"});await page.getByRole("heading",{name:"Prompt safety checks"}).waitFor();
 const privacy=await page.locator("article").innerText();
 for(const fact of ["Alibaba Cloud Object Storage Service", "How your information is protected", "File retention and deletion", "hashes", "HTTPS", "anyone who obtains it"]) assert.ok(privacy.includes(fact),fact);
 assert.doesNotMatch(privacy,/Not yet published|Checking published details/);
 const contact=page.locator('footer a[href^="mailto:"]');
 assert.equal(await contact.innerText(),"support@example.test");
 assert.equal(decodeURIComponent((await contact.getAttribute("href")).split("?")[0]),"mailto:support@example.test");
 state="larger";
 const hydrated=await browser.newPage();const errors=[];hydrated.on("pageerror",error=>errors.push(error.message));
 await hydrated.goto(base+"/pricing",{waitUntil:"networkidle"});
 await hydrated.getByRole("button",{name:"12× credits",exact:true}).click();
 assert.match(await hydrated.locator(".plan-price").innerText(),/\$100/);assert.match(await hydrated.locator(".plan-credit").innerText(),/7,200/);
 assert.deepEqual(errors,[]);
 console.log("Public pricing passed: anonymous/no-JavaScript USD prices, credits and exact-setting examples; immediate price changes; empty/error distinction; mobile layout; hydration and larger pack; configured safety/privacy disclosure.");
}finally{
 await browser?.close();
 app.kill();await Promise.race([new Promise(resolve=>app.once("exit",resolve)),new Promise(resolve=>setTimeout(resolve,5000))]);
 await new Promise(resolve=>fixture.close(resolve));
}
