import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {mkdir} from "node:fs/promises";
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||"playwright-core");
const base=process.env.FRONTEND_TEST_URL||"http://127.0.0.1:3101";
const secret="tc_sk_browser_fixture_only";
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{channel:"chrome"})});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1040},permissions:["clipboard-read","clipboard-write"]});
 await context.addInitScript(()=>{
  localStorage.setItem("access_token","setup-fixture-token");localStorage.setItem("refresh_token","setup-fixture-refresh");
  window.setupImports=[];
  const click=HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click=function(){if(this.href.startsWith("ccswitch:")){window.setupImports.push(this.href);return;}return click.call(this);};
 });
 let modelState="ok",keyEnabled=true;const calls=[];
 await context.route("**/api/**",async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;calls.push({path,method:request.method()});
  let data={};
  if(path==="/api/auth/me")data={id:"801",username:"alex",nickname:"Alex",role:0,points:600,status:1};
  else if(path==="/api/auth/api-key")data={hint:"tc_sk_…only",enabled:keyEnabled,revision:1,name:"Default"};
  else if(path==="/api/auth/api-key/reveal")data={key:secret,revision:1};
  else if(path==="/api/integrations/v1/models"){
   assert.equal(request.headers().authorization,`Bearer ${secret}`);
   if(modelState==="failed")return route.fulfill({status:503,json:{error:{message:"unavailable"}}});
   return route.fulfill({json:{object:"list",data:modelState==="empty"?[]:[{id:"flowinglight/gpt-test",name:"GPT Test"},{id:"flowinglight/second-model",name:"Second model"}]}});
  }else if(path==="/api/points/summary")data={balance:600,totalEarned:600,totalSpent:0};
  else if(path.includes("records")||path.includes("orders")||path.includes("files")||path.includes("projects"))data={records:[],total:0};
  else if(path.includes("unread-count"))data={count:0};
  return route.fulfill({json:{success:true,code:200,data}});
 });
 const page=await context.newPage();const errors=[];page.on("pageerror",error=>errors.push(error.message));
 await page.goto(base+"/account",{waitUntil:"networkidle"});
 const open=page.getByRole("button",{name:"使用密钥",exact:true});await open.click();
 let dialog=page.getByRole("dialog",{name:"使用 API 密钥"});await dialog.locator("pre").first().waitFor();
 assert.match(await dialog.locator("pre").first().innerText(),/wire_api = "responses"/);
 assert.ok((await dialog.locator("pre").first().innerText()).includes(base+"/api/integrations/v1"));
 for(const [shell,expected] of [["macOS / Linux","export FLOWLIGHT_API_KEY="],["PowerShell","$env:FLOWLIGHT_API_KEY"],["Windows CMD",'set "FLOWLIGHT_API_KEY=']]){
  await dialog.getByRole("button",{name:shell,exact:true}).click();assert.ok((await dialog.locator("pre").last().innerText()).includes(expected));
 }
 await dialog.locator(".key-setup-code").last().getByRole("button").click();
 assert.ok((await page.evaluate(()=>navigator.clipboard.readText())).includes(secret));
 // A failed repeat copy must not retain the earlier success indicator.
 await page.evaluate(()=>{
  window.originalSetupWrite=navigator.clipboard.writeText.bind(navigator.clipboard);
  navigator.clipboard.writeText=async()=>{throw new DOMException("Denied","NotAllowedError");};
 });
 await dialog.locator(".key-setup-code").last().getByRole("button").click();
 await dialog.getByRole("alert").getByText(/复制失败/).waitFor();
 assert.equal(await dialog.locator(".key-setup-code").last().getByRole("button").innerText(),"复制");
 await page.evaluate(()=>{navigator.clipboard.writeText=window.originalSetupWrite;});
 await dialog.getByRole("button",{name:"复制 Base URL"}).click();
 assert.match(await dialog.getByRole("button",{name:"复制 Base URL"}).innerText(),/已复制/);
 assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),base+"/api/integrations/v1");
 await dialog.getByRole("tab",{name:"OpenCode",exact:true}).click();
 const opencode=JSON.parse(await dialog.locator("pre").first().innerText());assert.equal(opencode.provider.flowlight.options.apiKey,"{env:FLOWLIGHT_API_KEY}");
 await dialog.getByRole("button",{name:"使用模型",exact:true}).click();await page.getByRole("option",{name:/Second model/}).click();
 assert.match(await dialog.locator("pre").first().innerText(),/flowinglight\/second-model/);
 await dialog.getByRole("button",{name:"使用模型",exact:true}).click();await page.keyboard.press("Escape");assert.equal(await page.getByRole("dialog").count(),1);
 // Escape must first close the dropdown even before its menu takes focus.
 await dialog.getByRole("button",{name:"使用模型",exact:true}).click();
 await dialog.getByRole("button",{name:"使用模型",exact:true}).focus();
 await page.keyboard.press("Escape");assert.equal(await page.getByRole("dialog").count(),1);
 await page.keyboard.press("Escape");assert.equal(await page.getByRole("dialog").count(),0);assert.equal(await open.evaluate(el=>el===document.activeElement),true);
 await page.getByRole("button",{name:"导入到 CC Switch",exact:true}).click();
 dialog=page.getByRole("dialog",{name:"导入到 CC Switch",exact:true});await dialog.getByRole("button",{name:"使用模型",exact:true}).waitFor();
 await dialog.getByRole("button",{name:"打开 CC Switch 导入",exact:true}).click();
 const imported=new URL(await page.evaluate(()=>window.setupImports[0]));
 assert.equal(imported.searchParams.get("apiKey"),secret);assert.equal(imported.searchParams.get("app"),"codex");
 assert.equal(imported.searchParams.get("endpoint"),base+"/api/integrations/v1");
 assert.equal(await page.locator('a[href^="ccswitch:"]').count(),0,"Secret import URL must not remain in the DOM");
 assert.match(await dialog.getByRole("status").innerText(),/网页无法判断/);
 const dir=".runtime/api-key-setup";await mkdir(dir,{recursive:true});
 await dialog.screenshot({path:dir+"/ccswitch-desktop.png"});
 await dialog.getByRole("button",{name:"改用手动配置"}).click();dialog=page.getByRole("dialog",{name:"使用 API 密钥"});await dialog.screenshot({path:dir+"/manual-desktop.png"});
 await page.setViewportSize({width:390,height:844});
 const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,elements:Array.from(document.querySelectorAll("body *")).filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&(r.right>innerWidth+1||r.left< -1)}).slice(-25).map(el=>({tag:el.tagName,class:el.className,width:el.getBoundingClientRect().width,right:el.getBoundingClientRect().right}))}));
 if(overflow.scroll>overflow.width)console.log(JSON.stringify(overflow));
 assert.equal(overflow.scroll>overflow.width,false);
 await page.getByRole("dialog").screenshot({path:dir+"/manual-mobile.png"});
 // Same-tab token changes are checked again before copying/importing.
 await page.evaluate(()=>localStorage.setItem("access_token","different-session"));
 await page.getByRole("dialog").locator(".key-setup-code").first().getByRole("button").click();
 assert.match(await page.getByRole("dialog").getByRole("alert").innerText(),/登录状态已变化/);
 await page.evaluate(()=>window.dispatchEvent(new StorageEvent("storage",{key:"access_token"})));
 assert.equal(await page.getByRole("dialog").count(),0);assert.equal(await page.getByRole("button",{name:"使用密钥",exact:true}).count(),0);
 await page.evaluate(()=>localStorage.setItem("access_token","setup-fixture-token"));
 for(const state of ["failed","empty"]){
  modelState=state;await page.reload({waitUntil:"networkidle"});await page.getByRole("button",{name:"导入到 CC Switch",exact:true}).click();
  dialog=page.getByRole("dialog");await dialog.getByText(state==="failed"?/模型列表暂时无法读取/:/暂时没有可用的对话模型/).waitFor();
  assert.equal(await dialog.getByRole("button",{name:"打开 CC Switch 导入"}).isDisabled(),true);
  if(state==="failed"){modelState="ok";await dialog.getByRole("button",{name:"重试",exact:true}).click();await dialog.getByRole("button",{name:"使用模型",exact:true}).waitFor();assert.equal(await dialog.getByRole("button",{name:"打开 CC Switch 导入"}).isEnabled(),true);}
  await dialog.getByRole("button",{name:"关闭",exact:true}).click();
 }
 keyEnabled=false;await page.reload({waitUntil:"networkidle"});assert.equal(await page.getByRole("button",{name:"使用密钥",exact:true}).isDisabled(),true);
 assert.equal(calls.some(call=>/chat\/completions|\/responses|\/generate/.test(call.path)),false,"Setup must not create paid requests");
 assert.deepEqual(errors,[]);
 console.log("API key setup passed: both entry points, actual model IDs, three shells, safe copies, CC Switch encoded import, session invalidation, disabled/empty/error states, Escape/focus restoration and mobile layout. External application launch was intercepted.");
}finally{await browser.close();}
