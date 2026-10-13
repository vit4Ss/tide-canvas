import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const base = process.env.FRONTEND_TEST_URL || "http://localhost:3100";
const browser = await chromium.launch({ headless:true, ...(process.platform === "win32" ? { executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" } : { channel:"chrome" }) });
try {
  const context = await browser.newContext({viewport:{width:390,height:844}});
  await context.addInitScript(() => localStorage.setItem("access_token","existing-checkout-fixture"));
  const pending = { id:"9001",orderNo:"PENDING-MONTHLY",type:"plan",market:"en",currency:"USD",payMethod:"stripe",cycle:"monthly",amount:12,credits:600,status:0,createTime:new Date().toISOString(),payUrl:"https://checkout.stripe.com/c/pay/cs_test_original" };
  const processing = { ...pending,id:"9002",orderNo:"PROCESSING-PAYMENT",paymentProcessing:true,payUrl:"" };
  const writes=[];
  await context.route("**/api/**",async route=>{
    const path=new URL(route.request().url()).pathname;let data={};
    if(route.request().method()==="POST")writes.push({path,body:route.request().postDataJSON()});
    if(path==="/api/auth/me")data={id:"701",username:"alex",nickname:"Alex",points:10,vipLevel:0};
    else if(path==="/api/billing/en/plans")data=[{id:"801",market:"en",currency:"USD",name:"Creator",monthly:12,yearly:120,monthlyPoints:600,items:[],vipLevel:1}];
    else if(path==="/api/billing/en/channels")data=[{key:"stripe",name:"Stripe",currency:"USD"}];
    else if(path==="/api/billing/en/faq")data={items:[]};
    else if(path==="/api/billing/en/compare")data={rows:[]};
    else if(path==="/api/en/orders")data={...pending,existingCheckout:true};
    else if(path==="/api/orders/9001")data=pending;
    else if(path==="/api/orders")data={records:[pending,processing],total:2,pageNum:1,pageSize:15};
    await route.fulfill({json:{success:true,code:200,data}});
  });
  const page=await context.newPage();const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto(`${base}/pricing`,{waitUntil:"networkidle"});
  await page.getByRole("button",{name:"12× credits",exact:true}).click();
  await page.getByRole("button",{name:"Choose this plan"}).click();
  await page.getByRole("button",{name:"Continue to checkout"}).click();
  await page.waitForURL("**/billing?order=9001&existing=1");
  await page.getByText("You already have an unfinished purchase for this plan.",{exact:false}).waitFor();
  assert.match(await page.locator(".invoice-total").innerText(),/^\$12$/);
  await page.getByText("Standard credit pack",{exact:true}).waitFor();
  assert.equal(writes[0].body.cycle,"yearly");
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.getByRole("link",{name:"Order history",exact:true}).first().click();
  await page.getByText("PROCESSING-PAYMENT",{exact:true}).waitFor();
  const processingRow=page.getByRole("row").filter({hasText:"PROCESSING-PAYMENT"});
  assert.match(await processingRow.innerText(),/Payment processing/);
  assert.equal(await processingRow.getByRole("button",{name:"Cancel",exact:true}).count(),0);
  const pendingRow=page.getByRole("row").filter({hasText:"PENDING-MONTHLY"});
  assert.equal(await pendingRow.getByRole("button",{name:"Cancel",exact:true}).count(),1);
  assert.equal(errors.length,0,errors.join("\n"));
  console.log("Existing checkout passed: cycle-switch handoff, original amount disclosure, mobile layout and processing-order cancellation gate.");
} finally { await browser.close(); }
