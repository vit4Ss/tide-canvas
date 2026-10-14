import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright-core");
const base = process.env.FRONTEND_TEST_URL || "http://127.0.0.1:3000";
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : { channel: "chrome" }) });
const times = ["00:28:17", "00:28:13", "00:25:05", "00:24:53", "00:24:52"];
const fees = ["0.224470", "0.076930", "0.107580", "0.342500", "0.441450"];
const remainders = ["0.192930", "0.968460", "0.891530", "0.783950", "0.441450"];
const usages = [[8993,555,8704], [8903,59,8576], [8742,188,8576], [6664,31,0], [8709,20,0]];
const records = fees.map((points,i)=>({id:String(i+1),model:"gpt-5.6-sol",modelName:"GPT 5.6 Sol",keyRevision:1,keyHint:"test-key",requestPath:"/api/integrations/v1/responses",stream:true,status:"success",points,netPoints:points,refundedPoints:"0",settlementMode:"accumulated",deductedPoints:i===0?"1":"0",pendingPointsAfter:remainders[i],reservedPoints:"10",inputTokens:usages[i][0],outputTokens:usages[i][1],cachedInputTokens:usages[i][2],reasoningTokens:0,usageKnown:true,createTime:`2026-10-14T${times[i]}+08:00`,durationMs:12030,firstTokenMs:5290,priceMultiplier:"2",pricing:{inputPointsPerMillion:"50",outputPointsPerMillion:"300",cachedInputPointsPerMillion:"5"}}));
const data={records,total:5,pages:1,pageNum:1,pageSize:20,summary:{calls:5,points:"1.192930",deductedPoints:"1",pendingTokenPoints:"0.192930",inputTokens:42011,outputTokens:853,cachedInputTokens:25856,pending:0}};
await mkdir(".runtime/chat-accrual-review",{recursive:true});
try {
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:"reduce"});
 await context.addInitScript(()=>localStorage.setItem("access_token","accrual-browser-fixture"));
 const mutations=[],errors=[];
 await context.route("**/api/**",async route=>{const req=route.request(),path=new URL(req.url()).pathname;let result=[];
   if(req.method()!=="GET")mutations.push(path);
   if(path==="/api/auth/me")result={id:"1",username:"tester",nickname:"Tester",role:9,status:1,points:18.80707,postedPoints:19,pendingTokenPoints:.19293,menus:[],adminPerms:[]};
   else if(path==="/api/chat-gateway/usage")result=data;
   else if(path==="/api/points/records")result={records:[{id:"ledger-1",changeType:"consume",amount:-1,balance:10000.123456,remark:"AI 聊天小数累计扣款",createTime:"2026-10-14T00:28:17+08:00"}],total:1,pageNum:1,pageSize:15};
   else if(path==="/api/points/checkin")result={checkedToday:true,continuousDays:1};
   else if(path==="/api/notifications/unread-count")result={count:0};
   else if(path.includes("/notifications"))result={records:[],total:0};
   else if(path.includes("/config"))result={};
   await route.fulfill({json:{success:true,code:200,data:result,message:""}});
 });
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on("pageerror",e=>errors.push(e.message));
 await page.goto(base+"/api-usage",{waitUntil:"networkidle"});
 const table=page.getByRole("table");await table.waitFor();
 await page.getByText("1.19293",{exact:true}).waitFor();
 await table.getByText("0.22447",{exact:true}).waitFor();
 assert.equal(await table.getByText("扣款 0 积分",{exact:true}).count(),4);
 assert.equal(await table.getByText("扣款 1 积分",{exact:true}).count(),1);
 assert.match(await page.locator("body").innerText(),/当前账户待累计 0.19293 积分/);
 await page.getByRole("button",{name:"查看 gpt-5.6-sol 调用详情",exact:true}).first().click();
 await page.getByText("本次账户扣款（含累计）",{exact:true}).waitFor();
 await page.getByText("结算后待累计小数",{exact:true}).waitFor();
 assert.match(await page.locator("body").innerText(),/本次扣款可能包含此前累计费用/);
 await page.screenshot({path:".runtime/chat-accrual-review/desktop.png",fullPage:true});
 for(const width of [768,390,320]) {await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`page overflow ${width}`);if(width===390)await page.screenshot({path:".runtime/chat-accrual-review/mobile.png",fullPage:true});}
 // A refund can return one posted point even when this call originally posted
 // zero: the remainder keeps the net reversal equal to this call's actual fee.
 Object.assign(records[4], {netPoints:"0",refundedPoints:"0.441450",walletRefundedPoints:"1"});
 Object.assign(data.summary, {points:"0.751480",walletRefundedPoints:"1",pendingTokenPoints:"0.751480"});
 await page.reload({waitUntil:"networkidle"});
 await page.getByText("本范围入账退回 1 积分",{exact:false}).waitFor();
 await page.getByRole("button",{name:"查看 gpt-5.6-sol 调用详情",exact:true}).last().click();
 await page.getByText("整数到账退款",{exact:true}).waitFor();
 await page.getByText("已退 0.44145",{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,"refund details overflow mobile");
 await page.goto(base+"/account/points",{waitUntil:"networkidle"});
 await page.getByText(/另有 0.19293 积分待累计/).waitFor();
 await page.getByText(/余额 10,000.123456/).waitFor();
 assert.equal(await page.getByRole("link",{name:"查看 Token 用量"}).getAttribute("href"),"/api-usage");
 assert.deepEqual(mutations,[]);assert.deepEqual(errors,[]);
 console.log("PASS: exact fractional fees, whole-point debits, refund breakdown, pending-fee ledger explanation, six-decimal ledger balances, 320–1440 usage layouts, no mutations.");
} finally { await browser.close(); }
