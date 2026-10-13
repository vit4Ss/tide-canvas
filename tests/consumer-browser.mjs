import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { mkdir, readFile } from "node:fs/promises";
import { unzipSync } from "fflate";
const base=process.env.FRONTEND_TEST_URL || "http://localhost:3100";
const browser=await chromium.launch({headless:true,...(process.platform==="win32"?{executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"}:{channel:"chrome"}),args:["--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
const artifacts=".impeccable/review/consumer-fixed";await mkdir(artifacts,{recursive:true});
const models=[
  {id:"image",name:"Image A",modelKey:"image-a",type:"image",pointCost:"4",config:{resolutions:["1K"],ratios:["16:9"],modes:["t2i","i2i"]}},
  {id:"video",name:"Video A",modelKey:"video-a",type:"video",pointCost:"12",config:{resolutions:["720p","1080p"],ratios:["16:9"],durations:["5s","10s"],modes:["t2v","i2v"]}},
  {id:"audio",name:"Suno V5",modelKey:"suno-v5",type:"audio",pointCost:"10",config:{}},
  {id:"3d",name:"HY 3D",modelKey:"hy-3d",type:"3d",pointCost:"40",config:{}}
];
const user={id:"701",username:"alex",nickname:"Alex",points:200,vipLevel:3};
const plan={id:"801",market:"en",currency:"USD",name:"Creator",monthly:12,yearly:120,monthlyPoints:600,items:[],vipLevel:1};
const tasks=[{id:"11",modelName:"Image A",handler:"text_to_image",resultUrl:"/art/coast.jpg",resultMeta:{},input:{prompt:"Coast"},status:1,pointCost:4,createTime:new Date().toISOString()},{id:"12",modelName:"Image B",handler:"text_to_image",resultUrl:"/art/architecture.jpg",resultMeta:{},status:1,pointCost:4,createTime:new Date().toISOString()},{id:"13",modelName:"HY 3D",handler:"generate_3d",resultUrl:"/qa/model.gltf",resultMeta:{},status:1,pointCost:40,createTime:new Date().toISOString()}];
const tri=new Float32Array([-1,0,0,1,0,0,0,1,0]);
const gltf=JSON.stringify({asset:{version:"2.0"},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0},mode:4}]}],buffers:[{uri:"data:application/octet-stream;base64,"+Buffer.from(tri.buffer).toString("base64"),byteLength:36}],bufferViews:[{buffer:0,byteLength:36}],accessors:[{bufferView:0,componentType:5126,count:3,type:"VEC3",min:[-1,0,0],max:[1,1,0]}]});
try {
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 let registrationClosed=true, published=false, stall=false;
 const writes=[];const errors=[];
 await context.route("**/qa/model.gltf",route=>route.fulfill({contentType:"model/gltf+json",body:gltf}));
 await context.route("**/api/**",async route=>{
  const r=route.request(),u=new URL(r.url()),p=u.pathname;let data={};
  if(r.method()!=="GET")writes.push({p,body:r.postDataJSON()});
  if(p==="/api/auth/register-config")data={registerClosed:registrationClosed};
  else if(p==="/api/billing/en/consumer")data={supportEmail:"gudexin748@gmail.com",commercialUse:"",retention:"",refundTiming:"",creditValidity:"",membershipTerms:""};
  else if(p==="/api/auth/me")data=user;
  else if(p==="/api/auth/login")data={accessToken:"review-access",refreshToken:"review-refresh",userInfo:user};
  else if(p==="/api/auth/google/challenge")return route.fulfill({status:503,json:{success:false,code:503,message:"Google sign-in is temporarily unavailable."}});
  else if(p==="/api/market/studio-models"){if(stall)return;data=models.filter(m=>!u.searchParams.get("type")||m.type===u.searchParams.get("type"));}
  else if(p==="/api/ai/optimize-cost")data={cost:1};
  else if(p==="/api/ai/tasks"){
   const kind=t=>t.handler.includes("image")?"image":t.handler==="generate_3d"?"3d":"video";
   const rows=tasks.filter(t=>(!u.searchParams.get("mediaType")||kind(t)===u.searchParams.get("mediaType"))&&(!u.searchParams.get("keyword")||`${t.displayName||""} ${t.modelName}`.toLowerCase().includes(u.searchParams.get("keyword").toLowerCase())));
   data={records:rows,total:rows.length,pages:1};
  } else if(/\/api\/ai\/tasks\/\d+\/name/.test(p)){tasks.find(t=>p.endsWith(`/${t.id}/name`)).displayName=r.postDataJSON().name;data=null;}
  else if(p==="/api/billing/en/plans")data=published?[plan]:[];
  else if(p==="/api/billing/en/channels")data=published?[{key:"stripe",name:"Stripe",currency:"USD"}]:[];
  else if(p==="/api/billing/en/faq")data={items:[]};
  else if(p==="/api/billing/en/compare")data={rows:[]};
  else if(p==="/api/billing/en/promo")data={enabled:false};
  else if(p==="/api/points/balance")data={points:200,frozen:10};
  else if(p==="/api/points/summary")data={opening:10,added:220,deducted:20,refunded:2,total:210,reserved:10,available:200};
  else if(p==="/api/ai/history"||p==="/api/files")data={records:[],total:0,pages:1};
  else if(p==="/api/community/posts")data={records:[{id:"pub1",type:"image",cover:"/art/coast.jpg",thumbnail:"/art/coast.jpg",model:"image-a",title:"Published coast",author:{name:"Example creator"}}],total:1};
  else if(p==="/api/files/download-ticket")data={url:"/api/files/download?ticket=fixture",native:false};
  else if(p==="/api/files/download")return route.fulfill({contentType:"image/jpeg",body:await readFile("public/art/coast.jpg")});
  await route.fulfill({json:{success:true,code:200,data}});
 });
 const page=await context.newPage();page.on("pageerror",e=>errors.push(e.message));
 await page.goto(`${base}/signup`);await page.getByText("New account registration is currently closed",{exact:false}).waitFor();
 assert.equal(await page.getByRole("button",{name:"Create your account",exact:true}).isVisible(),false);
 assert.equal(await page.locator('[aria-label="Google sign-in"]').count(),0);
 await page.goto(`${base}/pricing`);await page.getByText("Credit packs are not on sale yet.",{exact:true}).waitFor();
 assert.match(await page.getByRole("link",{name:"Ask about availability"}).getAttribute("href"),/gudexin748/);
 await page.goto(`${base}/studio?type=video`);await page.locator('#studio-model').getByText("Video A",{exact:true}).waitFor();
 const prompt="Keep this product-film draft through sign-in and reload.";
 await page.locator('#studio-prompt').fill(prompt);await page.getByRole("button",{name:"Sign in to create",exact:true}).click();
 await page.waitForURL('**/login**');assert.match(page.url(),/draft/);
 await page.goBack();await page.waitForFunction(value=>document.querySelector('#studio-prompt')?.value===value,prompt);
 await page.getByRole("button",{name:"Sign in to create",exact:true}).click();
 await page.locator('#auth-account').fill("alex");await page.locator('#auth-password').fill("fixture-password");await page.getByRole("button",{name:"Sign in",exact:true}).click();
 await page.waitForURL('**/studio**');await page.waitForFunction(value=>document.querySelector('#studio-prompt')?.value===value,prompt);
 assert.equal(await page.getByRole('tab',{name:'Video',exact:true}).getAttribute('aria-selected'),"true");
 await page.reload();await page.waitForFunction(value=>document.querySelector('#studio-prompt')?.value===value,prompt);
 await page.getByRole('tab',{name:'Audio',exact:true}).click();await page.locator('#studio-model').getByText('Suno V5',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Try an idea',exact:true}).click();assert.match(await page.locator('#studio-prompt').inputValue(),/music|piano|acoustic/i);
 await page.getByText('Audio options',{exact:true}).click();assert.equal(await page.locator('#studio-voice').count(),0);await page.locator('#studio-lyrics').waitFor();
 published=true;await page.goto(`${base}/pricing`);await page.reload();await page.getByRole('button',{name:'12× credits',exact:true}).click();
 assert.match(await page.locator('.plan-price').innerText(),/\$120/);assert.doesNotMatch(await page.locator('.plan-price').innerText(),/month/);
 await page.getByRole('button',{name:'Buy more credits',exact:true}).click();assert.match(await page.getByRole('dialog').innerText(),/7,200/);await page.getByRole('button',{name:'Not now',exact:true}).click();
 await page.screenshot({path:`${artifacts}/pricing-desktop.png`,fullPage:true});
 await page.goto(`${base}/models`);for(let i=0;i<3;i++)await page.getByRole('button',{name:'Compare',exact:true}).first().click();
 await page.getByRole('button',{name:'Compare',exact:true}).first().click();await page.getByText('Compare up to three models.',{exact:false}).waitFor();
 await page.getByRole('button',{name:'Examples',exact:true}).first().click();await page.getByAltText('Published coast').waitFor();await page.getByRole('button',{name:'Close dialog'}).click();
 await page.goto(`${base}/library`);await page.getByRole('button',{name:'Rename Image A',exact:true}).click();await page.locator('#library-asset-name').fill('Product hero');await page.getByRole('button',{name:'Save name',exact:true}).click();await page.getByRole('heading',{name:'Product hero',exact:true}).waitFor();
 await page.getByRole('checkbox',{name:'Select Product hero',exact:true}).check();await page.getByRole('checkbox',{name:'Select Image B',exact:true}).check();
 const waiting=page.waitForEvent('download');await page.getByRole('button',{name:'Download selected (2)',exact:true}).click();const file=await waiting;
 const zip=unzipSync(new Uint8Array(await readFile(await file.path())));assert.equal(Object.keys(zip).length,2);assert.ok(Object.keys(zip).some(name=>name.includes('Product hero')));
 const singleWaiting=page.waitForEvent('download');await page.getByRole('button',{name:'Download Product hero',exact:true}).click();const single=await singleWaiting;assert.equal(single.suggestedFilename(),'Product hero.jpg');assert.ok((await readFile(await single.path())).length>100);
 await page.getByRole('textbox',{name:'Search your library'}).fill('Product hero');await page.getByRole('button',{name:'Search',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.library-card').length===1);
 await page.getByRole('button',{name:'Clear library search'}).click();await page.getByRole('heading',{name:'HY 3D',exact:true}).waitFor();
 await page.locator('.library-card').filter({has:page.getByRole('heading',{name:'HY 3D',exact:true})}).getByRole('button',{name:'Preview creation',exact:true}).click();await page.locator('model-viewer').waitFor();
 await page.waitForFunction(()=>document.querySelector('model-viewer')?.loaded===true,{timeout:30000});assert.equal(await page.locator('model-viewer').getAttribute('camera-controls'),"");
 await page.screenshot({path:`${artifacts}/3d-preview.png`});await page.getByRole('button',{name:'Close dialog'}).click();
 await page.goto(`${base}/usage`);await page.getByText('Reconcile your account balance',{exact:true}).click();await page.getByText('Credits added (including refunds)',{exact:true}).waitFor();assert.doesNotMatch(await page.locator('main').innerText(),/Text Model|assistant_chat/);
 await page.clock.install();stall=true;await page.goto(`${base}/studio?type=image`);await page.getByText('Finding your models…',{exact:true}).waitFor();await page.clock.fastForward(16000);await page.getByText('This is taking longer than expected.',{exact:false}).first().waitFor();
 stall=false;await page.getByRole('button',{name:'Retry',exact:true}).click();await page.locator('#studio-model').getByText('Image A',{exact:true}).waitFor();
 await page.clock.resume();await page.setViewportSize({width:390,height:844});
 for(const route of ['studio','library','pricing','help']){await page.goto(`${base}/${route}`);await page.locator('h1').waitFor();await page.waitForTimeout(500);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`overflow: ${route}`);if(route==='studio'){const box=await page.getByRole('button',{name:'Generate',exact:true}).boundingBox();assert.ok(box && box.y>=0 && box.y+box.height<=844,'Mobile creation action is reachable without scrolling');assert.equal(await page.locator('.generation-actions').evaluate(e=>getComputedStyle(e).position),'static','Cost panel must not obscure the prompt');}await page.screenshot({path:`${artifacts}/${route}-mobile.png`,fullPage:true});}
 assert.equal(writes.some(w=>w.p.includes('generate')||w.p==='/api/en/orders'),false,'No paid requests during consumer review');
 assert.deepEqual(errors,[]);
 await context.close();console.log('Consumer journeys passed: registration, empty pricing/support, draft back/login/reload, audio capabilities, credit packs, comparison/examples, rename/search/ZIP, 3D, account totals, timeout/retry, desktop/mobile.');
}finally{await browser.close();}
