import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright-core");
const base = process.env.FRONTEND_TEST_URL || "http://127.0.0.1:3215";
const dir = process.env.TEMPLATE_REVIEW_DIR || ".runtime/template-workshop-review";
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : { channel: "chrome" }) });
const catalog = JSON.parse(await readFile(new URL("../../tide-canvas-server/internal/handler/studiotemplate/samples.json", import.meta.url), "utf8"));
const templates = catalog.map(({ template }, i) => ({ ...template, id: String(i+1), uses: 0, inputHint: i===4 ? "图片1上传人物，图片2上传服装。" : "上传你自己的素材，系统自动完成同款效果。", ...(template.mediaType === "video" ? { status: 1, mode: "ref", requirements: {images:0,videos:1,audio:1}, previewUrl: base+"/fixture.mp4" } : {}) }));
const publicRow = template => { const row = { ...template }; for (const key of ['prompt','modelKey','status','sortOrder']) delete row[key]; return row; };
let catalogModelName="Fixture Model",catalogDelay=0,catalogFails=false;
let owner="801", uploaded=0, loseResponse=false, quoteFails=false, catalogueFails=false, adminCatalogueFails=false, failNextTask=false, deletedTask=false, templateHidden=false, uploadFails=false, verifyFilesFails=false, setupFails=false, uploadDelay=0;
const coverRequests=[],coverTasks=new Map();let loseCoverResponse=false,coverPollPaused=false,failCoverTask=false,coverModelAvailable=true,failTemplateSave=false;
const submits=[], quotes=[], checks=[], tasks=new Map(), storedFiles=new Map(), errors=[];
const context=await browser.newContext({viewport:{width:1440,height:1000}});
await context.addInitScript(()=>localStorage.setItem("access_token","template-fixture"));
await context.route("**/fixture.mp4",route=>route.fulfill({status:404,body:"fixture only"}));
await context.route("**/api/**",async route=>{
 const req=route.request(),url=new URL(req.url()),path=url.pathname;
 let data={};
 const fail=(message,code=400)=>route.fulfill({status:code,json:{success:false,code,message,data:null}});
 if(path==="/api/auth/me")data={id:owner,username:"reviewer",nickname:"Reviewer",role:9,status:1,points:1000,menus:['discover','studio','inspire','analysis','three_d','tools','chat','canvas','explore','assets'],adminPerms:[]};
 else if(path.startsWith('/api/admin/dashboard/'))return fail('fixture dashboard unavailable',503);
 else if(path==="/api/market/studio-models"){
 const delayed=catalogDelay,failed=catalogFails;data=[{id:"41",modelKey:"fixture-model",name:catalogModelName,type:"image",config:{modes:["i2i"],resolutions:["2k"],ratios:["4:5"],qualities:["high"]}},{id:"42",modelKey:"fixture-square",name:"Square Model",type:"image",config:{modes:["i2i"],resolutions:["1k"],ratios:["1:1"],qualities:["standard"]}},{id:"43",modelKey:"fixture-basic",name:"Basic Image",type:"image",config:{modes:["i2i"],ratios:["1:1"],hideBatchCount:true}},{id:"44",modelKey:"fixture-video",name:"Fixture Video",type:"video",config:{modes:["i2v"],ratios:["16:9","9:16"],resolutions:["1080p","720p"],durations:[10,4.5],qualities:["high"]}}].filter(model=>!url.searchParams.get("type")||model.type===url.searchParams.get("type"));
 if(delayed)await new Promise(resolve=>setTimeout(resolve,delayed));if(failed)return fail("模拟模型目录读取失败",503);
 }
 else if(path==="/api/ai/models")data=[{id:"cover-model",modelId:coverModelAvailable?"fixture-cover":"replacement-cover",name:coverModelAvailable?"封面测试模型":"替代图片模型",type:"image",pointCost:7,config:JSON.stringify({imagePrimary:true,modes:['t2i'],ratios:['16:9'],resolutions:['2k'],qualities:['high']})},{id:"edit-only",modelId:"edit-only",name:"不能文生图",type:"image",pointCost:5,config:JSON.stringify({modes:['i2i']})}];
 else if(path==="/api/points/balance")data={points:1000,frozen:0};
 else if(path==="/api/ai/optimize-cost")data={cost:0};
 else if(path==="/api/admin/studio-templates/check"){
  const recipe=req.postDataJSON();checks.push(recipe);if(recipe.options.resolution==='8k')return fail('模型不支持所填分辨率「8k」，请改为支持的值（默认 2k）或留空');
  data={modelId:"fixture-model",modelName:"Fixture Model",handler:"image_to_image",basePointCost:7,referenceVideoBilling:false,options:{resolution:"2k",aspectRatio:"4:5",quality:"high"},maxUploadBytes:{image:52428800,video:52428800,audio:52428800}};
 }
 else if(/^\/api\/admin\/studio-templates\/\d+$/.test(path)){
  const row=templates.find(t=>t.id===path.split('/').at(-1));if(req.method()==='PUT'){if(failTemplateSave){failTemplateSave=false;return fail('模拟模板保存失败',503);}Object.assign(row,req.postDataJSON());data=row;}else if(req.method()==='DELETE'){templates.splice(templates.indexOf(row),1);data={};}
 }
 else if(path.startsWith("/api/ai/template-setup/") && setupFails)return fail("模拟规格读取失败",503);
 else if(path.startsWith("/api/ai/template-setup/") && Number(path.split('/').at(-1))>=20000){const row=templates.find(t=>t.id===path.split('/').at(-1));data={modelId:"fixture-video",modelName:"Fixture Video",handler:"reference_to_video",basePointCost:7,referenceVideoBilling:false,options:row.options,maxUploadBytes:{image:52428800,video:52428800,audio:52428800}};}
 else if(path.startsWith("/api/ai/template-setup/")) data={modelId:"fixture-model",modelName:"Fixture Model",handler:"image_to_image",basePointCost:7,referenceVideoBilling:false,options:{resolution:"2k",aspectRatio:"4:5",quality:"high"},maxUploadBytes:{image:52428800,video:52428800,audio:52428800}};
 else if(path.startsWith("/api/files/detail/")){if(verifyFilesFails)return fail("模拟核验失败",503);data=storedFiles.get(path.split('/').at(-1));if(!data||data.ownerId!==owner)return fail("素材不存在",404);}
 else if(path==="/api/files/download-ticket")data={url:"/api/files/download?ticket=fixture",native:false};
 else if(path==="/api/files/download")return route.fulfill({status:200,headers:{"Content-Type":"image/png","Content-Disposition":"attachment; filename=template.png"},body:Buffer.from('fixture-file')});
 else if(path==="/api/files/upload" && uploadFails)return fail("模拟上传失败");
 else if(path==="/api/files/presign"){
  if(uploadDelay)await new Promise(resolve=>setTimeout(resolve,uploadDelay));
  if(uploadFails)return fail("模拟上传失败");
  const upload=req.postDataJSON();uploaded++;
  data={existingFile:{id:String(600+uploaded),ownerId:owner,fileUrl:base+`/studio-samples/v1/${upload.filename==='outfit.png'?'starlight-fashion':'rainy-cinema'}.webp`,fileType:upload.contentType.split('/')[0],mimeType:upload.contentType,originalName:upload.filename,fileSize:upload.size}};storedFiles.set(data.existingFile.id,data.existingFile);
 }else if(path==="/api/studio-templates"||path==="/api/admin/studio-templates"){
  if(adminCatalogueFails&&path.includes('admin'))return fail('模拟后台模板加载失败',503);
  if(catalogueFails && !path.includes("admin"))return fail("fixture catalogue unavailable",503);
  if(req.method()==="POST"){data={...req.postDataJSON(),id:String(10001+templates.length),uses:0};templates.push(data);}
  else {const rows=templates.filter(t=>(path.includes("admin")||t.status===1)&&(!url.searchParams.get('mediaType')||t.mediaType===url.searchParams.get('mediaType'))&&(!url.searchParams.get('category')||t.category===url.searchParams.get('category'))&&(!url.searchParams.get('kind')||t.kind===url.searchParams.get('kind'))&&(!url.searchParams.get('keyword')||t.title.includes(url.searchParams.get('keyword'))));data={records:path.includes('admin')?rows:rows.map(publicRow),categories:[...new Set(rows.map(t=>t.category).filter(Boolean))],pages:1,total:rows.length,pageNum:1,pageSize:18};}
 }else if(/^\/api\/studio-templates\/\d+$/.test(path)){const row=templates.find(t=>t.id===path.split('/').at(-1));if(!row||row.status!==1||templateHidden)return fail("模板已下架或不存在",404);data=publicRow(row);}
 else if(path==="/api/ai/template-quote"){
  const body=req.postDataJSON();quotes.push(body);assert.deepEqual(Object.keys(body.input).sort(),body.input.imageSlots?['audioIds','imageIds','imageSlots','videoIds']:['audioIds','imageIds','videoIds']);
  if(quoteFails)return fail("模板输出规格尚未配置价格");
  data={templateId:body.templateId,modelId:"fixture-model",modelName:"Fixture Model",handler:body.templateId==="7"||Number(body.templateId)>=20000?"reference_to_video":"image_to_image",pointCost:7,quoteToken:"fixture-quote",options:{resolution:"2k",aspectRatio:"4:5",quality:"high",...(body.templateId==="7"?{duration:5}:{})},basePointCost:7,referencePointCost:0};
  if(Number(body.templateId)>=20000)data.options=templates.find(t=>t.id===body.templateId).options;
 }else if(path==="/api/ai/generate"){
  const body=req.postDataJSON();
  if(!body.templateId&&body.handler==='text_to_image'){
   coverRequests.push(body);assert.ok(body.clientRequestId);assert.equal(body.input.batchCount,1);assert.equal(body.input.aspectRatio,'16:9');assert.equal(body.modelId,'fixture-cover');assert.equal('imageIds' in body.input,false);assert.equal(body.input.prompt.includes('{{image:'),false);
   let task=coverTasks.get(body.clientRequestId);if(!task){task={id:String(80001+coverTasks.size),handler:'text_to_image',modelName:'封面测试模型',status:0,progress:10,pointCost:7,resultUrl:base+'/studio-samples/v1/tidal-product.webp?cover='+(coverTasks.size+1),resultMeta:{},input:body.input,fail:failCoverTask};coverTasks.set(body.clientRequestId,task);failCoverTask=false;}
   if(loseCoverResponse){loseCoverResponse=false;return route.abort('failed');}
   return route.fulfill({json:{success:true,code:200,data:task}});
  }
  submits.push(body);assert.ok(body.templateId && body.templateQuote && body.clientRequestId);assert.equal('prompt' in body.input,false);assert.equal('imageUrls' in body.input,false);
  let task=tasks.get(body.clientRequestId);
  if(!task){task={id:String(5001+tasks.size),handler:body.handler,modelName:"Fixture Model",status:0,progress:30,pointCost:7,resultUrl:base+"/studio-samples/v1/tidal-product.webp",resultMeta:templates.find(row=>row.id===body.templateId)?.options?.batchCount>1?{urls:[base+"/studio-samples/v1/tidal-product.webp",base+"/studio-samples/v1/rainy-cinema.webp"]}:{},input:{templateId:body.templateId,templateTitle:"Fixture Template"},createTime:new Date().toISOString(),fail:failNextTask};tasks.set(body.clientRequestId,task);failNextTask=false;}
  if(loseResponse){loseResponse=false;return route.abort('failed');}
  data=task;
 }else if(/^\/api\/ai\/tasks\/\d+$/.test(path)){data=[...coverTasks.values()].find(t=>t.id===path.split('/').at(-1));if(data){if(!coverPollPaused){data.status=data.fail?2:1;data.progress=100;if(data.fail)data.errorMsg='模拟封面生成失败';}return route.fulfill({json:{success:true,code:200,data}});}
  data=[...tasks.values()].find(t=>t.id===path.split('/').at(-1));if(!data||deletedTask)return fail("not found",404);data.status=data.fail?2:1;data.progress=100;if(data.fail)data.errorMsg="生成失败，请稍后重试";}
 else if(path==="/api/ai/tasks"||path==="/api/ai/history"||path.includes("notifications"))data={records:[],total:0,pages:1};
 else if(path.endsWith("unread-count"))data={count:0};
 else if(path==="/api/admin/studio-templates/sources")data={records:[{id:"9001",userId:owner,mediaType:"image",prompt:"导入的运营提示词",model:"Fixture Model",resultUrl:base+"/studio-samples/v1/tidal-product.webp",createTime:"2026-10-20T00:00:00Z"}],total:1,pages:1};
 else if(path==="/api/admin/studio-templates/from-task")data={...templates[4],id:"9002",status:0,prompt:"导入的运营提示词"};
 else if(path==="/api/ai/tools")data=[];
 await route.fulfill({json:{success:true,code:200,data}});
});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
page.on('console',message=>{if(message.type()==='error' && message.text().includes('页面渲染错误'))errors.push(message.text());});
const imageFile={name:'portrait.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=','base64')};
const snap=async name=>process.env.CAPTURE_REVIEW==='0'||(process.env.CAPTURE_RESULTS_ONLY==='1'&&!name.startsWith('result-'))?undefined:page.screenshot({path:`${dir}/${name}.png`,fullPage:true,animations:'disabled'});
try{
 // Exercise real client navigation: storefront CSS must not decorate admin footers.
 await page.goto(base+'/terms',{waitUntil:'networkidle'});
 const siteFooter=page.locator('footer.site-footer');await siteFooter.waitFor();
 const publicFooter=await siteFooter.evaluate(el=>({after:getComputedStyle(el,'::after').content,padding:parseFloat(getComputedStyle(el).paddingTop)}));
 assert.ok(publicFooter.after.includes('FLOWING LIGHT')&&publicFooter.padding>=40,'public footer lost its intended styling');
 await page.evaluate(()=>{window.__templateFooterAudit='same-document';});
 await page.locator('.acct-trigger').click();await page.getByRole('menuitem',{name:'管理后台',exact:true}).click();
 await page.getByRole('link',{name:'创作模板',exact:true}).click();await page.getByRole('button',{name:'新建风格',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.__templateFooterAudit),'same-document','test did not navigate with resident storefront CSS');
 await page.getByRole('button',{name:/^灵感做同款/}).click();await page.getByRole('heading',{name:'星光秀场换装',exact:true}).waitFor();
 const adminCards=page.locator('.adm-content article');
 const footerStyles=await adminCards.locator('footer').evaluateAll(els=>els.map(el=>({after:getComputedStyle(el,'::after').content,background:getComputedStyle(el).backgroundColor,paddingTop:parseFloat(getComputedStyle(el).paddingTop),paddingBottom:parseFloat(getComputedStyle(el).paddingBottom)})));
 assert.equal(footerStyles.length,2);
 for(const value of footerStyles){assert.ok(!value.after.includes('FLOWING'),'site watermark leaked into card actions');assert.notEqual(value.background,'rgb(10, 10, 11)','site dark background leaked into admin');assert.ok(value.paddingTop<=16&&value.paddingBottom<24,'site spacing leaked into card actions');}
 const pager=page.getByRole('navigation',{name:'模板分页',exact:true});
 assert.equal(await pager.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');
 assert.ok((await pager.boundingBox()).height<90,'pager inherited oversized site-footer spacing');
 for(const card of await adminCards.all()){
  assert.ok((await card.boundingBox()).width>=340,'few templates remain squeezed into narrow columns');
  assert.equal(await card.locator('img').first().evaluate(el=>getComputedStyle(el).objectFit),'contain','admin preview crops the original artwork');
  const bounds=await card.locator('footer button, footer a').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().top));
  assert.ok(Math.max(...bounds)-Math.min(...bounds)<2,'desktop template actions wrap unnecessarily');
 }
 await snap('admin-style-leak-desktop');
 for(const width of [1920,1024,768,600,481,480,390,320]){
  await page.setViewportSize({width,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`admin template overflow at ${width}`);
  for(const card of await adminCards.all()){
   const bounds=await card.boundingBox(), available=await card.evaluate(el=>el.parentElement.clientWidth);assert.ok(bounds.width>=Math.min(320,available)-2,`two-card layout squeezes actions at ${width}`);
   assert.equal(await card.evaluate(el=>el.scrollWidth>el.clientWidth+1),false,`card content overflow at ${width}`);
  }
  if(width===390)await snap('admin-style-leak-mobile');
 }
 const adminSearch=page.getByRole('textbox',{name:'搜索模板',exact:true});
 await adminSearch.fill('  星光秀场换装  ');await page.getByRole('button',{name:'查询',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.adm-content article').length===1);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'single filtered card overflows');
 await adminSearch.fill('no-template-matches');await page.getByRole('button',{name:'查询',exact:true}).click();
 await page.getByRole('heading',{name:'没有找到匹配的模板',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'创建第一个模板',exact:true}).count(),0,'search miss pretends the catalogue is empty');
 await page.getByRole('button',{name:'清除筛选',exact:true}).click();await page.getByRole('heading',{name:'星光秀场换装',exact:true}).waitFor();
 adminCatalogueFails=true;await adminSearch.fill('request-failure');await page.getByRole('button',{name:'查询',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'模拟后台模板加载失败'}).waitFor();
 await pager.getByText('列表加载失败',{exact:true}).waitFor();
 assert.equal(await pager.getByRole('button',{name:'上一页',exact:true}).isDisabled(),true);
 assert.equal(await pager.getByRole('button',{name:'下一页',exact:true}).isDisabled(),true);
 adminCatalogueFails=false;await adminSearch.fill('');await page.getByRole('button',{name:'查询',exact:true}).click();
 await page.getByRole('heading',{name:'星光秀场换装',exact:true}).waitFor();
 await page.getByRole('button',{name:/^风格主题/}).click();await page.getByRole('heading',{name:'黏土奇遇',exact:true}).waitFor();
 for(const width of [600,1024]){
  await page.setViewportSize({width,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`multi-card layout overflow at ${width}`);
  for(const card of await adminCards.all())assert.equal(await card.evaluate(el=>el.scrollWidth>el.clientWidth+1),false,'multi-card action overflow');
 }
 const longRow=templates.find(t=>t.id==='1'), originalTitle=longRow.title, originalCategory=longRow.category;
 longRow.title='长标题测试'+('人物场景与服装素材'.repeat(12));longRow.category='较长的分类名称'.repeat(6);
 await adminSearch.fill('长标题测试');await page.getByRole('button',{name:'查询',exact:true}).click();await page.getByRole('heading',{name:longRow.title,exact:true}).waitFor();
 await page.setViewportSize({width:320,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'long operator content overflows mobile');
 assert.equal(await adminCards.first().evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
 longRow.title=originalTitle;longRow.category=originalCategory;
 await page.setViewportSize({width:1440,height:1000});
 assert.equal((await fetch(base+'/studio-samples/v1/generation-prompts.json')).status,404,'private artwork provenance is publicly served');
 await page.goto(base+"/templates",{waitUntil:'networkidle'});await page.getByRole('heading',{name:'黏土奇遇',exact:true}).waitFor();
 await page.getByRole('button',{name:'全部模板',exact:true}).click();await page.getByRole('button',{name:'全部风格',exact:true}).click();assert.equal(await page.getByRole('heading',{name:'黏土奇遇',exact:true}).isVisible(),true);
 assert.equal(await page.locator('textarea,[contenteditable=true]').count(),0);assert.ok(!(await page.locator('main').innerText()).includes('提示词'));
 await snap('gallery-desktop');await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await snap('gallery-mobile');
 await page.getByRole('textbox',{name:'搜索模板'}).fill('not-a-template');await page.getByRole('heading',{name:'没有找到匹配的模板'}).waitFor();await page.getByRole('button',{name:'清除筛选'}).click();await page.getByRole('heading',{name:'黏土奇遇',exact:true}).waitFor();
 await page.setViewportSize({width:1440,height:1000});
 await page.getByRole('textbox',{name:'搜索模板'}).fill('雨');await page.getByRole('heading',{name:'雨夜电影肖像',exact:true}).waitFor();await page.getByRole('link',{name:/雨夜电影肖像/}).click();await page.waitForURL(/\/templates\/3(?:\?|$)/);await page.getByRole('heading',{name:'换上你的素材',exact:true}).waitFor();await page.goBack({waitUntil:'networkidle'});assert.equal(await page.getByRole('textbox',{name:'搜索模板'}).inputValue(),'雨');
 await page.getByRole('link',{name:/雨夜电影肖像/}).click();await page.waitForURL(/\/templates\/3(?:\?|$)/);await page.getByRole('heading',{name:'换上你的素材',exact:true}).waitFor();await page.getByRole('main').getByRole('link',{name:'灵感和模板',exact:true}).click();assert.equal(await page.getByRole('textbox',{name:'搜索模板'}).inputValue(),'雨');
 await page.getByRole('button',{name:'清除搜索',exact:true}).click();await page.getByRole('heading',{name:'黏土奇遇',exact:true}).waitFor();await page.getByRole('main').evaluate(el=>{el.scrollTop=150;});await page.getByRole('link',{name:/星光秀场换装/}).click();await page.waitForURL(/\/templates\/5(?:\?|$)/);await page.getByRole('heading',{name:'换上你的素材',exact:true}).waitFor();const savedScroll=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('flowlight.template.scroll./templates')||'{}').inner);assert.ok(savedScroll>0);await page.goBack({waitUntil:'networkidle'});await page.waitForFunction(top=>Math.abs(document.querySelector('main').scrollTop-top)<2,savedScroll);
 await page.goto(base+"/templates/5",{waitUntil:'networkidle'});await page.getByRole('heading',{name:'星光秀场换装',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'生成同款',exact:true}).isDisabled(),true);assert.equal(await page.locator('textarea,[contenteditable=true]').count(),0);
 await snap('workshop-empty-desktop');
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.scrollTo(0,0));const firstUpload=await page.getByLabel('上传人物照片',{exact:true}).boundingBox();assert.ok(firstUpload&&firstUpload.y<844,'mobile first viewport hides upload');
 await page.getByRole('button',{name:'查看效果示例',exact:true}).click();await page.getByRole('button',{name:'收起示例，继续选素材',exact:true}).click();await page.setViewportSize({width:1440,height:1000});
 await page.getByLabel('上传人物照片',{exact:true}).setInputFiles(imageFile);await page.locator('small').filter({hasText:'已上传'}).waitFor();assert.equal(quotes.length,0);assert.equal(submits.length,0);
 await page.getByLabel('上传服装图片',{exact:true}).setInputFiles({...imageFile,name:'outfit.png'});await page.getByText('7 积分',{exact:true}).waitFor();
 uploadFails=true;uploadDelay=700;await page.getByLabel('上传人物照片',{exact:true}).setInputFiles({...imageFile,name:'replacement.png'});assert.equal(await page.getByRole('button',{name:'移除人物照片',exact:true}).isDisabled(),true);await page.getByText(/已保留原素材/).waitFor();await page.getByText('7 积分',{exact:true}).waitFor();assert.equal(await page.locator('small').filter({hasText:'已上传'}).count(),2);uploadFails=false;uploadDelay=0;
 verifyFilesFails=true;await page.reload({waitUntil:'networkidle'});await page.getByRole('button',{name:'重新核验素材',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'生成同款',exact:true}).isDisabled(),true);verifyFilesFails=false;await page.getByRole('button',{name:'重新核验素材',exact:true}).click();await page.getByText('7 积分',{exact:true}).waitFor();
 const uploadCountBeforeRefresh=uploaded;await page.reload({waitUntil:'networkidle'});await page.getByText('7 积分',{exact:true}).waitFor();assert.equal(uploaded,uploadCountBeforeRefresh);assert.equal(await page.locator('small').filter({hasText:'已上传'}).count(),2);await page.getByText(/成品规格：2k/).waitFor();
 await snap('workshop-desktop');
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 const submitBounds=await page.getByRole('button',{name:'生成同款',exact:true}).boundingBox();
 const uploadBottom=await page.locator('input[type=file]').evaluateAll(inputs=>Math.max(...inputs.map(input=>input.getBoundingClientRect().bottom)));
 assert.ok(submitBounds && submitBounds.y>=uploadBottom,'mobile submit control overlaps uploaded materials');
 await snap('workshop-mobile');await page.setViewportSize({width:1440,height:1000});
 await page.setViewportSize({width:768,height:1024});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await snap('workshop-tablet');await page.setViewportSize({width:1440,height:1000});
 loseResponse=true;await page.getByRole('button',{name:'生成同款',exact:true}).click();await page.getByRole('button',{name:'检查任务状态',exact:true}).waitFor();assert.equal(tasks.size,1);
 await page.getByRole('button',{name:'检查任务状态',exact:true}).click();await page.getByRole('heading',{name:'你的同款，完成了'}).waitFor();assert.equal(tasks.size,1);assert.equal(submits[0].clientRequestId,submits[1].clientRequestId);assert.deepEqual(submits[0].input.imageIds,['601','602']);await snap('result-desktop');
 assert.equal(await page.getByRole('region',{name:'生成结果预览'}).getByRole('img',{name:'生成的同款作品'}).count(),1);
 const downloadBounds=await page.getByRole('button',{name:'下载作品',exact:true}).boundingBox();assert.ok(downloadBounds && downloadBounds.y+downloadBounds.height<1000,'completed-work download is below desktop viewport');
 const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'下载作品',exact:true}).click();const downloaded=await downloadEvent;assert.equal(downloaded.suggestedFilename(),'星光秀场换装.webp');await downloaded.saveAs(`${dir}/downloaded-template.webp`);assert.equal(await readFile(`${dir}/downloaded-template.webp`,'utf8'),'fixture-file');
 const countBeforePreview=submits.length;await page.getByRole('button',{name:'模板效果',exact:true}).click();await page.getByRole('region',{name:'效果预览'}).waitFor();await page.getByRole('button',{name:'我的作品',exact:true}).click();assert.equal(submits.length,countBeforePreview,'preview toggle generated a new task');
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await snap('result-mobile');await page.setViewportSize({width:1440,height:1000});
 const beforeReload=submits.length;await page.reload({waitUntil:'networkidle'});await page.getByRole('heading',{name:'你的同款，完成了'}).waitFor();assert.equal(submits.length,beforeReload,'reload issued a paid request');
 templateHidden=true;await page.reload({waitUntil:'networkidle'});await page.getByRole('heading',{name:'暂时无法打开模板'}).waitFor();await page.getByRole('heading',{name:'你的同款，完成了'}).waitFor();assert.equal(submits.length,beforeReload);templateHidden=false;await page.reload({waitUntil:'networkidle'});await page.getByRole('heading',{name:'你的同款，完成了'}).waitFor();
 await page.getByRole('button',{name:'再次使用这个模板'}).click();await page.getByRole('button',{name:'生成同款',exact:true}).waitFor();
 failNextTask=true;await page.getByRole('button',{name:'生成同款',exact:true}).click();await page.getByRole('heading',{name:'本次生成未完成'}).waitFor();assert.equal(tasks.size,2);
 deletedTask=true;const beforeDeletion=submits.length;await page.reload({waitUntil:'networkidle'});await page.getByRole('button',{name:'开始新的模板操作',exact:true}).click();await page.getByText('7 积分',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'生成同款',exact:true}).isEnabled(),true);assert.equal(submits.length,beforeDeletion,'clearing a deleted task automatically generated');deletedTask=false;
 await page.goto(base+'/templates/7',{waitUntil:'networkidle'});await page.getByLabel('上传视频1',{exact:true}).setInputFiles({name:'video.mp4',mimeType:'video/mp4',buffer:Buffer.from('fixture')});await page.getByLabel('上传音频1',{exact:true}).setInputFiles({name:'audio.mp3',mimeType:'audio/mpeg',buffer:Buffer.from('fixture')});await page.getByText('7 积分',{exact:true}).waitFor();
 assert.equal(quotes.at(-1).input.videoIds.length,1);assert.equal(quotes.at(-1).input.audioIds.length,1);await snap('video-workshop');
 quoteFails=true;await page.getByRole('button',{name:'移除音频1'}).click();await page.getByLabel('上传音频1',{exact:true}).setInputFiles({name:'audio.mp3',mimeType:'audio/mpeg',buffer:Buffer.from('fixture')});await page.getByText('模板输出规格尚未配置价格',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'生成同款',exact:true}).isDisabled(),true);quoteFails=false;await page.getByRole('button',{name:'重新确认积分'}).click();await page.getByText('7 积分',{exact:true}).waitFor();
 owner='802';await page.reload({waitUntil:'networkidle'});await page.getByRole('heading',{name:'换上你的素材'}).waitFor();assert.equal(await page.locator('small').filter({hasText:'已上传'}).count(),0);assert.equal(await page.getByRole('button',{name:'生成同款',exact:true}).isDisabled(),true);
 await page.goto(base+'/templates/1',{waitUntil:'networkidle'});await page.getByLabel('上传主体照片',{exact:true}).setInputFiles(imageFile);await page.getByText('7 积分',{exact:true}).waitFor();
 setupFails=true;await page.reload({waitUntil:'networkidle'});await page.getByRole('button',{name:'重新读取规格',exact:true}).waitFor();templates[0].inputLabels={images:['角色照片']};setupFails=false;await page.getByRole('button',{name:'重新读取规格',exact:true}).click();await page.getByLabel('上传角色照片',{exact:true}).waitFor();await page.getByText('模板素材要求已更新，请按新要求重新选择素材。',{exact:true}).waitFor();assert.equal(await page.locator('small').filter({hasText:'已上传'}).count(),0);assert.equal(await page.getByRole('button',{name:'生成同款',exact:true}).isDisabled(),true);
 await page.getByLabel('上传角色照片',{exact:true}).setInputFiles(imageFile);await page.getByText('7 积分',{exact:true}).waitFor();const vanished=quotes.at(-1).input.imageIds[0];storedFiles.delete(vanished);await page.reload({waitUntil:'networkidle'});await page.getByText('此素材已不可用，请重新上传',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'生成同款',exact:true}).isDisabled(),true);
 await page.goto(base+'/studio',{waitUntil:'networkidle'});await page.locator('[contenteditable=true]').first().waitFor();assert.equal(await page.getByRole('tab',{name:'风格主题'}).count(),0);
 await page.locator('#type-tabs').getByRole('button',{name:'视频',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#durPills .on')?.textContent==='10s');await page.locator('#durPills').getByRole('button',{name:'4.5s',exact:true}).click();assert.equal(await page.locator('#durPills .on').innerText(),'4.5s');

 const beforeOperator=submits.length;await page.goto(base+'/admin/studio-templates',{waitUntil:'networkidle'});await page.getByRole('button',{name:'新建风格',exact:true}).click();const editor=page.getByRole('dialog',{name:'新建创作模板'});await editor.getByLabel(/^名称/).fill('运营测试风格');await editor.getByLabel(/完整提示词/).fill('admin-only-recipe');
 const imageCount=editor.getByRole('spinbutton',{name:'参考图片数量',exact:true});
 assert.equal(await editor.getByRole('button',{name:'减少参考图片',exact:true}).isDisabled(),true);
 await imageCount.fill('16');assert.equal(await editor.getByRole('button',{name:'增加参考图片',exact:true}).isDisabled(),true);
 await imageCount.fill('2');await editor.getByLabel('图片2用途',{exact:true}).waitFor();
 assert.equal(await editor.getByRole('spinbutton',{name:'参考视频数量',exact:true}).count(),0,'unsupported video input is shown for image mode');
 for(const name of ['创作模式','默认生成模型']){
  const control=await editor.getByRole('button',{name,exact:true}).evaluate(el=>({height:el.getBoundingClientRect().height,border:parseFloat(getComputedStyle(el).borderTopWidth)}));
  assert.ok(control.height>=40&&control.border>=1,`${name} lacks a visible control frame`);
 }
 await editor.getByRole('heading',{name:'提示词与素材',exact:true}).evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}));await snap('operator-inputs-desktop');
 await page.setViewportSize({width:390,height:844});assert.equal(await editor.evaluate(el=>el.scrollWidth>el.clientWidth+1),false);await editor.getByRole('heading',{name:'提示词与素材',exact:true}).evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}));await snap('operator-inputs-mobile');await page.setViewportSize({width:1440,height:1000});
 await editor.getByRole('button',{name:'创作模式',exact:true}).click();await page.getByRole('option',{name:'文生图',exact:true}).click();
 await editor.getByText('此模式不需要上传参考素材。',{exact:true}).waitFor();assert.equal(await editor.getByRole('spinbutton',{name:'参考图片数量',exact:true}).count(),0);
 await editor.getByRole('button',{name:'创作模式',exact:true}).click();await page.getByRole('option',{name:'图生图',exact:true}).click();
 await editor.getByLabel('图片1用途',{exact:true}).fill('主体照片');await editor.getByRole('button',{name:'保存草稿',exact:true}).click();await editor.waitFor({state:'hidden'});await page.getByRole('heading',{name:'运营测试风格',exact:true}).waitFor();assert.equal(templates.at(-1).inputLabels.images[0],'主体照片');

 const operatorRow=templates.at(-1);operatorRow.modelKey="fixture-model";operatorRow.options={resolution:"8k",aspectRatio:"4:5"};await page.reload({waitUntil:"networkidle"});
 await page.getByRole('button',{name:'编辑运营测试风格',exact:true}).click();const edit=page.getByRole('dialog',{name:'编辑创作模板'});
 await edit.getByLabel('封面图片',{exact:true}).fill(base+'/studio-samples/v1/rainy-cinema.webp');
 assert.equal(await edit.getByRole('button',{name:'分辨率',exact:true}).getAttribute('data-invalid'),'true','saved unsupported setting must remain visible until corrected');
 await edit.getByRole('button',{name:'检查生成配置',exact:true}).click();await edit.getByRole('alert').filter({hasText:'模型不支持'}).waitFor();assert.equal(await edit.getByLabel(/完整提示词/).inputValue(),'admin-only-recipe');
 await edit.getByRole('button',{name:'分辨率',exact:true}).click();const specMenu=page.getByRole('listbox',{name:'分辨率',exact:true});
 assert.equal(await specMenu.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)','admin dropdown inherited the dark site palette');
 assert.equal(await specMenu.getByRole('option',{name:'8k（不在模型配置中）',exact:true}).getAttribute('aria-disabled'),'true');
 await specMenu.focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
 assert.equal(await edit.getByRole('button',{name:'分辨率',exact:true}).innerText(),'2K');
 await edit.getByRole('button',{name:'默认生成模型',exact:true}).click();await page.getByRole('option',{name:'Square Model',exact:true}).click();
 const ratioControl=edit.getByRole('button',{name:'画面比例',exact:true});assert.equal(await ratioControl.getAttribute('data-invalid'),null);assert.ok((await ratioControl.innerText()).includes('1:1'),'switch retained unsupported ratio');
 await edit.getByRole('button',{name:'默认生成模型',exact:true}).click();await page.getByRole('option',{name:'Basic Image',exact:true}).click();
 for(const label of ['分辨率','质量','生成数量','视频时长'])assert.equal(await edit.getByRole('button',{name:label,exact:true}).count(),0,`unconfigured ${label} is visible`);
 assert.equal(await edit.getByPlaceholder('如 1080p / 2K').count(),0,'free-text fallback still visible');
 await edit.getByRole('button',{name:'默认生成模型',exact:true}).click();await page.getByRole('option',{name:'Fixture Model',exact:true}).click();
 await edit.getByRole('button',{name:'分辨率',exact:true}).click();await page.getByRole('option',{name:'2K',exact:true}).click();
 await edit.getByRole('button',{name:'画面比例',exact:true}).click();await page.getByRole('option',{name:'4:5',exact:true}).click();
 await edit.getByRole('button',{name:'生成数量',exact:true}).click();await page.getByRole('option',{name:'3 张',exact:true}).click();
 assert.equal(await edit.getByRole('button',{name:'视频时长',exact:true}).count(),0);
 await edit.getByRole('button',{name:'检查生成配置',exact:true}).click();await edit.getByText('配置检查通过',{exact:true}).waitFor();assert.equal(submits.length,beforeOperator,'operator preflight generated a task');
 await edit.getByText('配置检查通过',{exact:true}).scrollIntoViewIfNeeded();await snap('operator-check-desktop');await page.setViewportSize({width:390,height:844});await edit.getByText('配置检查通过',{exact:true}).scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await snap('operator-check-mobile');await page.setViewportSize({width:1440,height:1000});
 await edit.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('alertdialog',{name:'放弃未保存的修改？'}).getByRole('button',{name:'取消',exact:true}).click();assert.equal(await edit.getByRole('button',{name:'分辨率',exact:true}).innerText(),'2K');
 await edit.getByRole('button',{name:'展示状态',exact:true}).click();await page.getByRole('option',{name:'上架到灵感和模板',exact:true}).click();await edit.getByRole('button',{name:'保存并上架',exact:true}).click();await edit.waitFor({state:'hidden'});await page.getByRole('heading',{name:'运营测试风格',exact:true}).waitFor();
 assert.equal(operatorRow.modelKey,'fixture-model','default generation model was not saved');assert.equal(operatorRow.options.quality,'high','visible quality default was omitted from save');assert.equal(checks.at(-1).options.quality,'high');
 await page.getByRole('button',{name:'编辑运营测试风格',exact:true}).click();await edit.getByRole('button',{name:'刷新模型列表',exact:true}).waitFor();assert.equal(await edit.getByRole('button',{name:'默认生成模型',exact:true}).innerText(),'Fixture Model','saved default model was not restored');
 catalogModelName='运营维护名称（旗舰）';catalogDelay=800;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await edit.getByRole('button',{name:'正在读取模型…',exact:true}).waitFor();
 assert.equal(await edit.getByRole('button',{name:'保存并上架',exact:true}).isDisabled(),true);assert.equal(await edit.getByRole('button',{name:'检查生成配置',exact:true}).isDisabled(),true);
 assert.equal(await edit.getByRole('button',{name:'分辨率',exact:true}).innerText(),'2K','refresh hid the existing configuration');
 await edit.getByRole('button',{name:'默认生成模型',exact:true}).filter({hasText:catalogModelName}).waitFor();catalogDelay=0;
 const staleModelResponse=page.waitForResponse(response=>response.url().includes('/api/market/studio-models'));catalogModelName='过期名称';catalogDelay=800;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await edit.getByRole('button',{name:'正在读取模型…',exact:true}).waitFor();
 catalogModelName='运营维护名称（旗舰）';catalogDelay=0;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await edit.getByRole('button',{name:'刷新模型列表',exact:true}).waitFor();await staleModelResponse;await page.waitForTimeout(900);assert.equal(await edit.getByRole('button',{name:'默认生成模型',exact:true}).innerText(),catalogModelName,'late response overwrote current model name');
 catalogFails=true;await edit.getByRole('button',{name:'刷新模型列表',exact:true}).click();await edit.getByRole('button',{name:'重试读取模型',exact:true}).waitFor();assert.equal(await edit.getByRole('button',{name:'保存并上架',exact:true}).isDisabled(),true);assert.equal(await edit.getByRole('button',{name:'检查生成配置',exact:true}).isDisabled(),true);
 assert.equal(await edit.getByRole('button',{name:'默认生成模型',exact:true}).innerText(),catalogModelName,'failed refresh lost known display name');catalogFails=false;await edit.getByRole('button',{name:'重试读取模型',exact:true}).click();await edit.getByRole('button',{name:'刷新模型列表',exact:true}).waitFor();await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='保存并上架'&&!b.disabled));assert.equal(await edit.getByRole('button',{name:'保存并上架',exact:true}).isEnabled(),true);

 assert.equal(await edit.getByLabel(/完整提示词/).inputValue(),'admin-only-recipe');assert.equal(await edit.getByRole('button',{name:'分辨率',exact:true}).innerText(),'2K');
 await edit.getByRole('button',{name:'取消',exact:true}).click();assert.equal(operatorRow.modelKey,'fixture-model','rename changed selected model ID');
 await page.goto(base+'/studio',{waitUntil:'networkidle'});await page.locator('#modelCard .ws-model-name').filter({hasText:catalogModelName}).waitFor();await page.goto(base+'/admin/studio-templates',{waitUntil:'networkidle'});
 await page.getByRole('button',{name:'编辑运营测试风格',exact:true}).click();catalogModelName='Fixture Model';await edit.getByRole('button',{name:'刷新模型列表',exact:true}).click();await edit.getByRole('button',{name:'默认生成模型',exact:true}).filter({hasText:'Fixture Model'}).waitFor();await edit.getByRole('button',{name:'取消',exact:true}).click();
 await page.getByRole('button',{name:'复制运营测试风格',exact:true}).click();const clone=page.getByRole('dialog',{name:'新建创作模板'});assert.equal(await clone.getByLabel(/^名称/).inputValue(),'运营测试风格（副本）');assert.equal(await clone.getByLabel(/完整提示词/).inputValue(),'admin-only-recipe');await clone.getByLabel(/^名称/).fill('复制后的新同款');await clone.getByRole('button',{name:'保存草稿',exact:true}).click();await clone.waitFor({state:'hidden'});await page.getByRole('heading',{name:'复制后的新同款',exact:true}).waitFor();assert.equal(templates.at(-1).status,0);assert.notEqual(templates.at(-1).id,operatorRow.id);assert.equal(operatorRow.title,'运营测试风格');
 await page.goto(base+'/templates/'+operatorRow.id,{waitUntil:'networkidle'});await page.getByLabel('上传主体照片',{exact:true}).setInputFiles(imageFile);await page.getByText('7 积分',{exact:true}).waitFor();await page.getByRole('button',{name:'生成同款',exact:true}).click();await page.getByRole('heading',{name:'你的同款，完成了'}).waitFor();assert.equal(submits.at(-1).templateId,operatorRow.id);assert.equal('prompt' in submits.at(-1).input,false);
 assert.equal(operatorRow.options.batchCount,3);await page.getByRole('button',{name:'第 2 张',exact:true}).click();assert.equal(await page.getByRole('img',{name:'生成的同款作品',exact:true}).getAttribute('src'),base+'/studio-samples/v1/rainy-cinema.webp');
 assert.equal(await page.getByRole('link',{name:'查看原文件',exact:false}).getAttribute('href'),base+'/studio-samples/v1/rainy-cinema.webp');
 assert.equal(await page.getByRole('link',{name:'打开完整生成结果',exact:true}).getAttribute('href'),base+'/studio-samples/v1/rainy-cinema.webp');
 await page.getByRole('button',{name:'再次使用这个模板',exact:true}).click();await page.getByText('7 积分',{exact:true}).waitFor();await page.getByRole('button',{name:'生成同款',exact:true}).click();await page.getByRole('heading',{name:'你的同款，完成了'}).waitFor();assert.equal(await page.getByRole('button',{name:'第 1 张',exact:true}).getAttribute('aria-pressed'),'true');


 await page.goto(base+'/admin/studio-templates',{waitUntil:'networkidle'});await page.getByRole('button',{name:'新建风格',exact:true}).click();const unfinished=page.getByRole('dialog',{name:'新建创作模板'});await unfinished.getByLabel(/^名称/).fill('尚未填提示词的草稿');await unfinished.getByRole('button',{name:'保存草稿',exact:true}).click();await unfinished.waitFor({state:'hidden'});await page.getByRole('heading',{name:'尚未填提示词的草稿',exact:true}).waitFor();
 await page.getByRole('button',{name:'从用户作品导入',exact:true}).click();await page.getByRole('button',{name:'导入为灵感草稿',exact:true}).click();assert.equal(await page.getByRole('dialog',{name:'编辑创作模板'}).getByLabel(/完整提示词/).inputValue(),'导入的运营提示词');

 const videoEditor=page.getByRole('dialog',{name:'编辑创作模板'});
 await videoEditor.getByRole('button',{name:'媒体类型',exact:true}).click();await page.getByRole('option',{name:'视频',exact:true}).click();
 await videoEditor.getByRole('button',{name:'默认生成模型',exact:true}).click();await page.getByRole('option',{name:'Fixture Video',exact:true}).click();
 for(const label of ['分辨率','质量','生成数量'])assert.equal(await videoEditor.getByRole('button',{name:label,exact:true}).count(),0,`image-only ${label} visible for video`);
 await videoEditor.getByRole('button',{name:'画面比例',exact:true}).click();await page.getByRole('option',{name:'9:16',exact:true}).click();
 await videoEditor.getByRole('button',{name:'清晰度',exact:true}).click();await page.getByRole('option',{name:'1080P',exact:true}).click();
 await videoEditor.getByRole('button',{name:'视频时长',exact:true}).click();await page.getByRole('option',{name:'4.5 秒',exact:true}).click();
 await videoEditor.getByRole('button',{name:'默认生成模型',exact:true}).scrollIntoViewIfNeeded();await snap('video-model-parameters-desktop');await page.setViewportSize({width:390,height:844});await videoEditor.getByRole('button',{name:'视频时长',exact:true}).scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await snap('video-model-parameters-mobile');

 await page.setViewportSize({width:1440,height:1000});await videoEditor.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('alertdialog',{name:'放弃未保存的修改？'}).getByRole('button',{name:'放弃修改',exact:true}).click();
 const contentPack=JSON.parse(await readFile(new URL('../../tide-canvas-server/internal/handler/studiotemplate/content-packs/store-food-v002/catalog.json',import.meta.url),'utf8'));
 const packRows=contentPack.entries.map((entry,i)=>({...entry.template,id:String(20000+i),uses:0}));templates.push(...packRows);
 await page.goto(base+'/admin/studio-templates',{waitUntil:'networkidle'});await page.getByRole('button',{name:/^灵感做同款/}).click();await page.getByRole('button',{name:'视频',exact:true}).click();await page.getByRole('heading',{name:'火锅店真人带看 · 15秒',exact:true}).waitFor();
 await page.getByRole('button',{name:'编辑火锅店真人带看 · 15秒',exact:true}).click();const packEditor=page.getByRole('dialog',{name:'编辑创作模板'});
 assert.equal(await packEditor.getByRole('spinbutton',{name:'参考图片数量',exact:true}).inputValue(),'6');assert.ok((await packEditor.getByLabel(/完整提示词/).inputValue()).includes('{{image:3}}'));
 const optionalPanel=packEditor.getByRole('group',{name:'可选图片位置',exact:true});assert.equal(await optionalPanel.getByRole('checkbox').count(),6);assert.equal(await optionalPanel.getByRole('checkbox').nth(2).isChecked(),true);assert.equal(await optionalPanel.getByRole('checkbox').nth(0).isChecked(),false);assert.equal(await packEditor.getByText('本人头像（选填，至少一种）',{exact:true}).count(),0);
 await optionalPanel.scrollIntoViewIfNeeded();await snap('content-pack-admin-desktop');await page.setViewportSize({width:390,height:844});await optionalPanel.scrollIntoViewIfNeeded();assert.equal(await packEditor.evaluate(el=>el.scrollWidth>el.clientWidth+1),false);await snap('content-pack-admin-mobile');await page.setViewportSize({width:1440,height:1000});await packEditor.getByRole('button',{name:'取消',exact:true}).click();

 await page.getByRole('button',{name:'编辑火锅店真人带看 · 30秒',exact:true}).click();const longEditor=page.getByRole('dialog',{name:'编辑创作模板'});
 await longEditor.getByRole('button',{name:'默认生成模型',exact:true}).click();await page.getByRole('option',{name:'Fixture Video',exact:true}).click();
 const longDuration=longEditor.getByRole('button',{name:'视频时长',exact:true});assert.equal(await longDuration.getAttribute('data-invalid'),'true');assert.ok((await longDuration.innerText()).includes('30'));await longEditor.getByText(/原模板为 30 秒，所选模型不支持/).waitFor();
 await longEditor.getByRole('button',{name:'默认生成模型',exact:true}).click();await page.getByRole('option',{name:'自动选择兼容模型（上架时确定）',exact:true}).click();
 await longEditor.getByRole('button',{name:'保存草稿',exact:true}).click();await longEditor.waitFor({state:'hidden'});assert.equal(packRows[10].options.duration,30,'automatic model selection dropped 30s template timeline');assert.equal(packRows[10].options.aspectRatio,'9:16');

 await page.getByRole('button',{name:'编辑火锅店真人带看 · 15秒',exact:true}).click();const coverEditor=page.getByRole('dialog',{name:'编辑创作模板'});
 const originalCover=base+'/studio-samples/v1/rainy-cinema.webp';await coverEditor.getByLabel('封面图片',{exact:true}).fill(originalCover);
 await coverEditor.getByLabel(/^名称/).fill('刚修改的火锅模板标题');
 await coverEditor.getByRole('button',{name:'AI 生成封面',exact:true}).click();const coverPanel=page.getByRole('region',{name:'AI 生成模板封面',exact:true});
 const coverGenerate=coverPanel.getByRole('button',{name:/^生成封面/});await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('生成封面 · 约 7 积分')&&!b.disabled));
 assert.ok((await coverPanel.getByRole('textbox',{name:'封面画面描述'}).inputValue()).includes('刚修改的火锅模板标题'));await coverEditor.getByLabel(/^名称/).fill('火锅店真人带看 · 15秒');
 assert.ok((await coverPanel.getByRole('textbox',{name:'封面画面描述'}).inputValue()).includes('火锅店真人带看'));assert.equal((await coverPanel.getByRole('textbox',{name:'封面画面描述'}).inputValue()).includes('{{image:'),false);
 await coverPanel.getByRole('button',{name:'封面图片模型',exact:true}).click();assert.equal(await page.getByRole('option',{name:'不能文生图',exact:true}).count(),0);await page.getByRole('option',{name:'封面测试模型',exact:true}).click();
 await coverPanel.scrollIntoViewIfNeeded();await snap('cover-ai-desktop');await page.setViewportSize({width:390,height:844});assert.equal(await coverEditor.evaluate(el=>el.scrollWidth>el.clientWidth+1),false);await coverPanel.scrollIntoViewIfNeeded();await snap('cover-ai-mobile');await page.setViewportSize({width:1440,height:1000});
 loseCoverResponse=true;await coverGenerate.evaluate(button=>{button.click();button.click();});await coverPanel.getByRole('button',{name:'检查封面任务状态',exact:true}).waitFor();assert.equal(coverTasks.size,1);assert.equal(coverRequests.length,1);assert.equal(await coverEditor.getByLabel('封面图片',{exact:true}).inputValue(),originalCover);
 coverPollPaused=true;await coverPanel.getByRole('button',{name:'检查封面任务状态',exact:true}).click();await coverPanel.getByRole('progressbar',{name:'封面生成进度'}).waitFor();assert.equal(coverTasks.size,1);assert.equal(coverRequests[0].clientRequestId,coverRequests[1].clientRequestId);assert.equal(await coverEditor.getByRole('button',{name:'保存草稿',exact:true}).isDisabled(),true);
 await coverPanel.getByRole('button',{name:'稍后查看封面任务',exact:true}).click();await coverPanel.waitFor({state:'hidden'});coverPollPaused=false;
 const generatedCover=base+'/studio-samples/v1/tidal-product.webp?cover=1';
 const waitForCover=url=>coverEditor.getByLabel('封面图片',{exact:true}).evaluate((el,url)=>new Promise((resolve,reject)=>{const start=Date.now();const tick=()=>{if(el.value===url)return resolve(true);if(Date.now()-start>10000)return reject(new Error('cover not filled: '+el.value));setTimeout(tick,50);};tick();}),url);
 await waitForCover(generatedCover);assert.equal(coverTasks.size,1);assert.equal(coverRequests.length,2);assert.equal(await coverPanel.isVisible(),false,'collapsed panel reopened by completion');assert.equal(packRows[0].coverUrl,'','cover generation saved the template without operator action');
 await coverEditor.getByText('AI 封面已填入，尚未保存。',{exact:true}).waitFor();
 await coverEditor.getByLabel('封面图片',{exact:true}).scrollIntoViewIfNeeded();await snap('cover-autofill-desktop');await page.setViewportSize({width:390,height:844});await coverEditor.getByLabel('封面图片',{exact:true}).scrollIntoViewIfNeeded();assert.equal(await coverEditor.evaluate(el=>el.scrollWidth>el.clientWidth+1),false);await snap('cover-autofill-mobile');await page.setViewportSize({width:1440,height:1000});
 // Refresh restores the generated result without opening the panel or charging again.
 coverModelAvailable=false;page.once('dialog',dialog=>dialog.accept());await page.reload({waitUntil:'networkidle'});await page.getByRole('button',{name:/^灵感做同款/}).click();await page.getByRole('button',{name:'视频',exact:true}).click();await page.getByRole('button',{name:'编辑火锅店真人带看 · 15秒',exact:true}).click();await waitForCover(generatedCover);assert.equal(await coverPanel.isVisible(),false);
 await coverEditor.getByRole('button',{name:'AI 生成封面',exact:true}).click();await coverPanel.getByText('已填入封面，请保存模板。',{exact:true}).waitFor();await coverPanel.getByRole('alert').filter({hasText:'原图片模型已不可用'}).waitFor();assert.equal(await coverPanel.getByRole('button',{name:'重新生成封面',exact:true}).isDisabled(),true,'missing original model was silently replaced');assert.equal(coverRequests.length,2);
 await coverPanel.getByRole('button',{name:'收起 AI 生成封面',exact:true}).click();coverModelAvailable=true;
 await coverEditor.getByRole('button',{name:'保存草稿',exact:true}).click();await coverEditor.waitFor({state:'hidden'});assert.equal(packRows[0].coverUrl,generatedCover);
 await page.getByRole('button',{name:'编辑火锅店真人带看 · 15秒',exact:true}).click();await coverEditor.getByRole('button',{name:'AI 生成封面',exact:true}).click();await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('生成封面 · 约 7 积分')&&!b.disabled));failCoverTask=true;
 await coverPanel.getByRole('button',{name:/^生成封面/}).click();await coverPanel.getByRole('alert').filter({hasText:'模拟封面生成失败'}).waitFor();assert.equal(await coverEditor.getByLabel('封面图片',{exact:true}).inputValue(),generatedCover,'failed generation replaced the current cover');assert.equal(coverTasks.size,2);
 // A manual replacement while the panel is collapsed wins over the in-flight result.
 coverPollPaused=true;await coverPanel.getByRole('button',{name:/^重新生成封面/}).click();await coverPanel.getByRole('progressbar',{name:'封面生成进度'}).waitFor();await coverPanel.getByRole('button',{name:'稍后查看封面任务',exact:true}).click();await coverEditor.getByLabel('封面图片',{exact:true}).fill(originalCover);coverPollPaused=false;
 await coverEditor.getByText(/封面已生成；当前封面或名称有修改/).waitFor();assert.equal(await coverEditor.getByLabel('封面图片',{exact:true}).inputValue(),originalCover);assert.equal(coverTasks.size,3);
 await coverEditor.getByRole('button',{name:'AI 生成封面',exact:true}).click();await coverPanel.getByRole('button',{name:'采用这张封面',exact:true}).click();const replacementCover=base+'/studio-samples/v1/tidal-product.webp?cover=3';await waitForCover(replacementCover);await coverPanel.getByRole('button',{name:'收起 AI 生成封面',exact:true}).click();
 // Failed save leaves the completed task recoverable, without another generation.
 failTemplateSave=true;await coverEditor.getByRole('button',{name:'保存草稿',exact:true}).click();await coverEditor.getByRole('alert').filter({hasText:'模拟模板保存失败'}).waitFor();assert.equal(packRows[0].coverUrl,generatedCover);
 const beforeSaveRetry=coverRequests.length;page.once('dialog',dialog=>dialog.accept());await page.reload({waitUntil:'networkidle'});await page.getByRole('button',{name:/^灵感做同款/}).click();await page.getByRole('button',{name:'视频',exact:true}).click();await page.getByRole('button',{name:'编辑火锅店真人带看 · 15秒',exact:true}).click();await waitForCover(replacementCover);assert.equal(coverRequests.length,beforeSaveRetry);await coverEditor.getByRole('button',{name:'保存草稿',exact:true}).click();await coverEditor.waitFor({state:'hidden'});assert.equal(packRows[0].coverUrl,replacementCover);

 // New templates get their own persisted ID before any paid cover request.
 await page.getByRole('button',{name:/^新建/}).click();let draftCoverEditor=page.getByRole('dialog',{name:'新建创作模板'});await draftCoverEditor.getByLabel(/^名称/).fill('新模板封面隔离 A');
 const beforeDraftCover=coverRequests.length;await draftCoverEditor.getByRole('button',{name:'保存草稿并制作封面',exact:true}).click();await page.getByRole('dialog',{name:'编辑创作模板'}).waitFor();const newDraftA=templates.at(-1);assert.equal(newDraftA.status,0);assert.equal(coverRequests.length,beforeDraftCover,'saving a draft unexpectedly charged for an image');
 const newCoverPanel=page.getByRole('region',{name:'AI 生成模板封面',exact:true});await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('生成封面 · 约 7 积分')&&!b.disabled));coverPollPaused=true;await newCoverPanel.getByRole('button',{name:/^生成封面/}).click();await newCoverPanel.getByRole('progressbar',{name:'封面生成进度'}).waitFor();
 await newCoverPanel.getByRole('button',{name:'稍后查看封面任务',exact:true}).click();await page.getByRole('dialog',{name:'编辑创作模板'}).getByRole('button',{name:'取消',exact:true}).click();
 await page.getByRole('button',{name:/^新建/}).click();draftCoverEditor=page.getByRole('dialog',{name:'新建创作模板'});await draftCoverEditor.getByLabel(/^名称/).fill('新模板封面隔离 B');await draftCoverEditor.getByRole('button',{name:'保存草稿并制作封面',exact:true}).click();await page.getByRole('dialog',{name:'编辑创作模板'}).waitFor();const newDraftB=templates.at(-1);assert.notEqual(newDraftA.id,newDraftB.id);
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('生成封面 · 约 7 积分')&&!b.disabled));assert.equal(await newCoverPanel.getByRole('progressbar').count(),0,'another unsaved template task leaked into this draft');assert.equal(await newCoverPanel.getByRole('img').count(),0);await newCoverPanel.getByRole('button',{name:'收起 AI 生成封面',exact:true}).click();await page.getByRole('dialog',{name:'编辑创作模板'}).getByRole('button',{name:'取消',exact:true}).click();
 // The original draft recovers its own pending task, including legacy journals.
 await page.evaluate(()=>{for(const key of Object.keys(localStorage)){if(!key.startsWith('tidecanvas.ai-generate.pending.'))continue;const rows=JSON.parse(localStorage.getItem(key));for(const row of rows){if(row.recovery){delete row.recovery.coverUrl;delete row.recovery.savedCoverUrl;}}localStorage.setItem(key,JSON.stringify(rows));}});
 coverPollPaused=false;await page.getByRole('button',{name:'编辑新模板封面隔离 A',exact:true}).click();await waitForCover(base+'/studio-samples/v1/tidal-product.webp?cover=4');assert.equal(coverRequests.length,beforeDraftCover+1);assert.equal(await newCoverPanel.isVisible(),false);
 await page.getByRole('dialog',{name:'编辑创作模板'}).getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('alertdialog',{name:'放弃未保存的修改？'}).getByRole('button',{name:'放弃修改',exact:true}).click();
 // Recovery pointers are account-isolated even for the same saved template.
 owner='803';await page.reload({waitUntil:'networkidle'});await page.getByRole('button',{name:/^灵感做同款/}).click();await page.getByRole('button',{name:'视频',exact:true}).click();await page.getByRole('button',{name:'编辑新模板封面隔离 A',exact:true}).click();await page.getByRole('dialog',{name:'编辑创作模板'}).getByRole('button',{name:'AI 生成封面',exact:true}).click();await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('生成封面 · 约 7 积分')&&!b.disabled));assert.equal(await newCoverPanel.getByRole('img').count(),0,'another account recovered the prior account cover');assert.equal(coverRequests.length,beforeDraftCover+1);
 await newCoverPanel.getByRole('button',{name:'收起 AI 生成封面',exact:true}).click();await page.getByRole('dialog',{name:'编辑创作模板'}).getByRole('button',{name:'取消',exact:true}).click();
 await page.goto(base+'/templates',{waitUntil:'networkidle'});assert.equal(await page.getByRole('heading',{name:'火锅店真人带看 · 15秒',exact:true}).count(),0,'draft pack leaked publicly');
 // Only this fixture is marked published to exercise upload behavior. Source data remains draft.
 packRows[0].status=1;packRows[0].coverUrl=base+'/studio-samples/v1/rainy-cinema.webp';packRows[0].previewUrl='';
 await page.goto(base+'/templates/20000',{waitUntil:'networkidle'});await page.getByLabel('上传门面照片',{exact:true}).waitFor();assert.equal(await page.locator('video').count(),0,'cover-only template pretends to have a video preview');await page.getByText(/当前展示的是封面示意图，尚无视频成片预览/).waitFor();assert.equal(await page.locator('input[type=file]').count(),6);assert.equal(await page.locator('textarea,[contenteditable=true]').count(),0);
 await page.getByLabel('上传门面照片',{exact:true}).setInputFiles({...imageFile,name:'shop-front.png'});await page.locator('small').filter({hasText:'已上传'}).waitFor();await page.getByLabel('上传店内全景',{exact:true}).setInputFiles({...imageFile,name:'shop-room.png'});await page.getByText('7 积分',{exact:true}).waitFor();
 assert.deepEqual(quotes.at(-1).input.imageSlots,[1,2]);assert.equal(await page.getByRole('button',{name:'生成同款',exact:true}).isEnabled(),true);
 await page.getByLabel('上传真实菜品',{exact:true}).setInputFiles({...imageFile,name:'food.png'});await page.getByText('7 积分',{exact:true}).waitFor();assert.deepEqual(quotes.at(-1).input.imageSlots,[1,2,4]);
 await page.getByText('成品规格：比例 9:16 · 15 秒',{exact:true}).waitFor();await snap('content-pack-user-desktop');await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await snap('content-pack-user-mobile');await page.setViewportSize({width:1440,height:1000});
 const beforePackReload=uploaded;await page.reload({waitUntil:'networkidle'});await page.getByText('7 积分',{exact:true}).waitFor();assert.equal(uploaded,beforePackReload);assert.deepEqual(quotes.at(-1).input.imageSlots,[1,2,4]);
 await page.getByRole('button',{name:'生成同款',exact:true}).click();await page.getByRole('heading',{name:'你的同款，完成了'}).waitFor();assert.deepEqual(submits.at(-1).input.imageSlots,[1,2,4]);assert.equal('prompt' in submits.at(-1).input,false);
 assert.deepEqual(errors,[]);console.log('PASS: prompt-free gallery/workshop and static assets, repeated active filters, owned image/video/audio IDs, quotes, ambiguous retry, refresh/unpublished/deleted-task recovery, account isolation, working Studio, admin edit/import, desktop/mobile.');
}catch(error){console.log(JSON.stringify({url:page.url(),body:(await page.locator('body').innerText().catch(()=>'')),errors}));throw error;}finally{await browser.close();}
