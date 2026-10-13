import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
const base=process.env.ADMIN_TEST_URL || "http://localhost:3101";
const browser=await chromium.launch({headless:true,...(process.platform==="win32"?{executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"}:{channel:"chrome"})});
try {
 const context=await browser.newContext({viewport:{width:1440,height:1050}});
 await context.addInitScript(()=>localStorage.setItem("access_token","consumer-admin-fixture"));
 let info={supportEmail:"gudexin748@gmail.com",commercialUse:"",retention:"",refundTiming:"",creditValidity:"",membershipTerms:""};const saves=[];
 await context.route("**/api/**",async route=>{
  const r=route.request(),p=new URL(r.url()).pathname;let data={};
  if(p==="/api/auth/me")data={id:"701",role:9,username:"admin",nickname:"Operator"};
  else if(p==="/api/admin/en/pricing/consumer"){if(r.method()==="PUT"){info=r.postDataJSON();saves.push(info);}data=info;}
  else if(p.endsWith("/plans"))data=[];
  else if(p.endsWith("/pricing/faq"))data={items:[]};
  else if(p.endsWith("/pricing/compare"))data={rows:[]};
  else if(p.endsWith("/pricing/promo"))data={enabled:false,deals:[]};
  else if(p==="/api/billing/en/channels")data=[];
  else if(p==="/api/auth/register-config")data={registerClosed:true};
  await route.fulfill({json:{success:true,code:200,data}});
 });
 const page=await context.newPage(),errors=[];page.on("pageerror",error=>errors.push(error.message));
 await page.goto(`${base}/admin/pricing`,{waitUntil:"networkidle",timeout:90000});
 await page.getByRole('button',{name:'英文站 · USD',exact:true}).click();
 await page.locator('input[type=email]').waitFor();assert.equal(await page.locator('input[type=email]').inputValue(),info.supportEmail);
 await page.locator('input[type=email]').fill('support@example.test');await page.locator('textarea').first().fill('Example policy for an isolated browser test.');
 await page.getByRole('button',{name:'保存消费者说明',exact:true}).click();await page.getByText('已保存，英文站刷新后生效。',{exact:true}).waitFor();
 assert.equal(saves.length,1);assert.equal(saves[0].commercialUse,'Example policy for an isolated browser test.');
 await page.getByRole('button',{name:'中文站 · CNY',exact:true}).click();assert.equal(await page.locator('input[type=email]').count(),0);
 await page.getByRole('button',{name:'英文站 · USD',exact:true}).click();await page.locator('input[type=email]').waitFor();assert.equal(await page.locator('input[type=email]').inputValue(),'support@example.test');
 await mkdir('.impeccable/review/consumer-fixed',{recursive:true});await page.screenshot({path:'.impeccable/review/consumer-fixed/admin-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'.impeccable/review/consumer-fixed/admin-mobile.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('Consumer policy admin passed: load/save/persist, EN/CN isolation, accurate readiness states, desktop/mobile.');
}finally{await browser.close();}
