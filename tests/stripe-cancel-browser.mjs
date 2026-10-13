import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const base=process.env.FRONTEND_TEST_URL||"http://localhost:3100";
const browser=await chromium.launch({headless:true,...(process.platform==="win32"?{executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"}:{channel:"chrome"})});
try {
  const results=[];
  for(const mode of ["failure","timeout"]){
    const context=await browser.newContext();
    await context.addInitScript(()=>{
      localStorage.setItem("access_token","cancel-fixture");
      const original=window.setTimeout;
      window.setTimeout=((fn,delay,...args)=>original(fn,delay===30_000?80:delay,...args));
    });
    let release;const gate=new Promise(resolve=>{release=resolve});
    let calls=0;
    await context.route("**/api/**",async route=>{
      const path=new URL(route.request().url()).pathname;let data={};
      if(path==="/api/auth/me")data={id:"701",username:"alex",nickname:"Alex",points:10};
      else if(path==="/api/orders")data={records:[{id:"9001",orderNo:"CANCEL-REVIEW",currency:"USD",payMethod:"stripe",amount:12,status:0,createTime:new Date().toISOString()}],total:1,pageNum:1,pageSize:15};
      else if(path==="/api/orders/9001/cancel"){
        calls++;if(mode==="timeout")await gate;
        await route.fulfill({status:503,json:{success:false,code:503,message:"Cancellation is temporarily unavailable."}}).catch(()=>{});return;
      }
      await route.fulfill({json:{success:true,code:200,data}});
    });
    const page=await context.newPage();page.setDefaultTimeout(2500);
    try{
      await page.goto(`${base}/account?tab=orders`,{waitUntil:"networkidle"});
      await page.getByRole("button",{name:"Cancel",exact:true}).click();
      const dialog=page.getByRole("dialog");await dialog.getByRole("button",{name:"Cancel order",exact:true}).click();
      await dialog.getByRole("alert").waitFor();
      assert.match(await dialog.getByRole("alert").innerText(),mode==="timeout"?/not confirmed/:/temporarily unavailable/);
      assert.equal(await dialog.getByRole("button",{name:"Cancel order",exact:true}).isEnabled(),true);
      assert.equal(calls,1,"Cancellation was automatically repeated");
      await page.keyboard.press("Escape");await dialog.waitFor({state:"hidden"});
      results.push({mode,passed:true});
    }catch(e){results.push({mode,passed:false,error:e.message})}
    finally{release();await context.close()}
  }
  console.log(JSON.stringify(results,null,2));assert.ok(results.every(r=>r.passed));
}finally{await browser.close()}
