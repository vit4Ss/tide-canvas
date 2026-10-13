import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const base=process.env.FRONTEND_TEST_URL||"http://localhost:3100";
const jwt=(uid)=>`header.${Buffer.from(JSON.stringify({uid})).toString("base64url")}.signature`;
const browser=await chromium.launch({headless:true,...(process.platform==="win32"?{executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"}:{channel:"chrome"})});
try{
  const results=[];
  for(const action of ["create","verify","resume","cancel"]){
    const context=await browser.newContext();await context.addInitScript(access=>localStorage.setItem("access_token",access),jwt("701"));
    const page=await context.newPage();const errors=[];page.on("pageerror",e=>errors.push(e.message));
    const endpoint=action==="create"?"/api/en/orders":`/api/orders/9001/${action==="resume"?"checkout":action}`;
    let started;const requested=new Promise(resolve=>{started=resolve});
    let release;const gate=new Promise(resolve=>{release=resolve});
    const order={id:"9001",orderNo:"OWNER-A-PRIVATE",market:"en",currency:"USD",payMethod:"stripe",amount:12,status:0,createTime:new Date().toISOString(),payUrl:action==="resume"?"":"https://checkout.stripe.com/c/pay/cs_test_owner_a"};
    await context.route("**/api/**",async route=>{
      const request=route.request();const path=new URL(request.url()).pathname;
      const owner=request.headers().authorization===`Bearer ${jwt("702")}`?"702":"701";let data={};
      if(path==="/api/auth/me")data={id:owner,username:owner==="701"?"alice":"bobby",nickname:owner==="701"?"Alice":"Bobby",points:10,vipLevel:0};
      else if(path==="/api/billing/en/plans")data=[{id:"801",name:"Creator",market:"en",currency:"USD",monthly:12,yearly:120,monthlyPoints:600,items:[],vipLevel:1}];
      else if(path==="/api/billing/en/channels")data=[{key:"stripe",name:"Stripe",currency:"USD"}];
      else if(path==="/api/billing/en/faq")data={items:[]};
      else if(path==="/api/billing/en/compare")data={rows:[]};
      else if(path==="/api/orders")data={records:owner==="701"?[order]:[],total:owner==="701"?1:0,pageNum:1,pageSize:15};
      else if(path==="/api/orders/9001"){
        if(owner==="702"){await route.fulfill({status:404,json:{success:false,code:404,message:"Order not found."}});return}
        data=order;
      }else if(path===endpoint){
        started();await gate;data=action==="verify"?{paid:true,granted:true}:order;
      }
      await route.fulfill({json:{success:true,code:200,data}}).catch(()=>{});
    });
    try{
      await page.goto(`${base}${action==="create"?"/pricing":action==="cancel"?"/account?tab=orders":"/billing?order=9001"}`,{waitUntil:"networkidle"});
      if(action==="create")await page.getByRole("button",{name:"Choose this plan"}).click();
      if(action==="cancel")await page.getByRole("button",{name:"Cancel",exact:true}).click();
      const name=action==="create"?"Continue to checkout":action==="resume"?"Prepare checkout":action==="cancel"?"Cancel order":"Check payment status";
      await page.getByRole("button",{name,exact:true}).click();await requested;
      const changed=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/auth/me"&&r.request().headers().authorization===`Bearer ${jwt("702")}`);
      await page.evaluate(({oldAccess,next})=>{localStorage.setItem("access_token",next);window.dispatchEvent(new StorageEvent("storage",{key:"access_token",oldValue:oldAccess,newValue:next}));},{oldAccess:jwt("701"),next:jwt("702")});
      await changed;release();await page.waitForLoadState("networkidle");
      const text=await page.locator("body").innerText();assert.doesNotMatch(text,/OWNER-A-PRIVATE|Payment confirmed/);
      assert.equal(await page.getByRole("link",{name:"Open secure checkout"}).count(),0);
      assert.equal(await page.getByRole("dialog").count(),0);
      if(action==="create")assert.equal(new URL(page.url()).pathname,"/pricing","Old owner response navigated new account");
      assert.equal(errors.length,0,errors.join("\n"));results.push({action,passed:true});
    }catch(e){results.push({action,passed:false,error:e.message})}
    finally{release();await context.close()}
  }
  console.log(JSON.stringify(results,null,2));assert.ok(results.every(r=>r.passed));
}finally{await browser.close()}
