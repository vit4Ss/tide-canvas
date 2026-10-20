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
let owner="801", uploaded=0, loseResponse=false, quoteFails=false, catalogueFails=false, adminCatalogueFails=false, failNextTask=false, deletedTask=false, templateHidden=false, uploadFails=false, verifyFilesFails=false, setupFails=false, uploadDelay=0;
const submits=[], quotes=[], tasks=new Map(), storedFiles=new Map(), errors=[];
const context=await browser.newContext({viewport:{width:1440,height:1000}});
await context.addInitScript(()=>localStorage.setItem("access_token","template-fixture"));
await context.route("**/fixture.mp4",route=>route.fulfill({status:404,body:"fixture only"}));
await context.route("**/api/**",async route=>{
 const req=route.request(),url=new URL(req.url()),path=url.pathname;
 let data={};
 const fail=(message,code=400)=>route.fulfill({status:code,json:{success:false,code,message,data:null}});
 if(path==="/api/auth/me")data={id:owner,username:"reviewer",nickname:"Reviewer",role:9,status:1,points:1000,menus:['discover','studio','inspire','analysis','three_d','tools','chat','canvas','explore','assets'],adminPerms:[]};
 else if(path.startsWith('/api/admin/dashboard/'))return fail('fixture dashboard unavailable',503);
 else if(path==="/api/market/studio-models")data=[{id:"41",modelKey:"fixture-model",name:"Fixture Model",type:"image",config:{modes:["i2i"],resolutions:["2k"],ratios:["4:5"],qualities:["high"]}}];
 else if(path==="/api/points/balance")data={points:1000,frozen:0};
 else if(path==="/api/ai/optimize-cost")data={cost:0};
 else if(path==="/api/admin/studio-templates/check"){
  const recipe=req.postDataJSON();if(recipe.options.resolution==='8k')return fail('模型不支持所填分辨率「8k」，请改为支持的值（默认 2k）或留空');
  data={modelId:"fixture-model",modelName:"Fixture Model",handler:"image_to_image",basePointCost:7,referenceVideoBilling:false,options:{resolution:"2k",aspectRatio:"4:5",quality:"high"},maxUploadBytes:{image:52428800,video:52428800,audio:52428800}};
 }
 else if(/^\/api\/admin\/studio-templates\/\d+$/.test(path)){
  const row=templates.find(t=>t.id===path.split('/').at(-1));if(req.method()==='PUT'){Object.assign(row,req.postDataJSON());data=row;}else if(req.method()==='DELETE'){templates.splice(templates.indexOf(row),1);data={};}
 }
 else if(path.startsWith("/api/ai/template-setup/") && setupFails)return fail("模拟规格读取失败",503);
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
  else {const rows=templates.filter(t=>(!url.searchParams.get('mediaType')||t.mediaType===url.searchParams.get('mediaType'))&&(!url.searchParams.get('category')||t.category===url.searchParams.get('category'))&&(!url.searchParams.get('kind')||t.kind===url.searchParams.get('kind'))&&(!url.searchParams.get('keyword')||t.title.includes(url.searchParams.get('keyword'))));data={records:path.includes('admin')?rows:rows.map(publicRow),categories:[...new Set(rows.map(t=>t.category))],pages:1,total:rows.length,pageNum:1,pageSize:18};}
 }else if(/^\/api\/studio-templates\/\d+$/.test(path)){const row=templates.find(t=>t.id===path.split('/').at(-1));if(!row||templateHidden)return fail("模板已下架或不存在",404);data=publicRow(row);}
 else if(path==="/api/ai/template-quote"){
  const body=req.postDataJSON();quotes.push(body);assert.deepEqual(Object.keys(body.input).sort(),['audioIds','imageIds','videoIds']);
  if(quoteFails)return fail("模板输出规格尚未配置价格");
  data={templateId:body.templateId,modelId:"fixture-model",modelName:"Fixture Model",handler:body.templateId==="7"?"reference_to_video":"image_to_image",pointCost:7,quoteToken:"fixture-quote",options:{resolution:"2k",aspectRatio:"4:5",quality:"high",...(body.templateId==="7"?{duration:5}:{})},basePointCost:7,referencePointCost:0};
 }else if(path==="/api/ai/generate"){
  const body=req.postDataJSON();submits.push(body);assert.ok(body.templateId && body.templateQuote && body.clientRequestId);assert.equal('prompt' in body.input,false);assert.equal('imageUrls' in body.input,false);
  let task=tasks.get(body.clientRequestId);
  if(!task){task={id:String(5001+tasks.size),handler:body.handler,modelName:"Fixture Model",status:0,progress:30,pointCost:7,resultUrl:base+"/studio-samples/v1/tidal-product.webp",resultMeta:{},input:{templateId:body.templateId,templateTitle:"Fixture Template"},createTime:new Date().toISOString(),fail:failNextTask};tasks.set(body.clientRequestId,task);failNextTask=false;}
  if(loseResponse){loseResponse=false;return route.abort('failed');}
  data=task;
 }else if(/^\/api\/ai\/tasks\/\d+$/.test(path)){data=[...tasks.values()].find(t=>t.id===path.split('/').at(-1));if(!data||deletedTask)return fail("not found",404);data.status=data.fail?2:1;data.progress=100;if(data.fail)data.errorMsg="生成失败，请稍后重试";}
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
 const beforeOperator=submits.length;await page.goto(base+'/admin/studio-templates',{waitUntil:'networkidle'});await page.getByRole('button',{name:'新建风格',exact:true}).click();const editor=page.getByRole('dialog',{name:'新建创作模板'});await editor.getByLabel(/^名称/).fill('运营测试风格');await editor.getByLabel(/完整提示词/).fill('admin-only-recipe');await editor.getByLabel('图片1用途',{exact:true}).fill('主体照片');await editor.getByRole('button',{name:'保存草稿',exact:true}).click();await page.getByRole('heading',{name:'运营测试风格',exact:true}).waitFor();assert.equal(templates.at(-1).inputLabels.images[0],'主体照片');

 const operatorRow=templates.at(-1);
 await page.getByRole('button',{name:'编辑运营测试风格',exact:true}).click();const edit=page.getByRole('dialog',{name:'编辑创作模板'});
 await edit.getByLabel('封面图片',{exact:true}).fill(base+'/studio-samples/v1/rainy-cinema.webp');await edit.getByLabel('分辨率',{exact:true}).fill('8k');await edit.getByRole('button',{name:'检查生成配置',exact:true}).click();await edit.getByRole('alert').filter({hasText:'模型不支持'}).waitFor();assert.equal(await edit.getByLabel(/完整提示词/).inputValue(),'admin-only-recipe');
 await edit.getByLabel('分辨率',{exact:true}).fill('2k');await edit.getByRole('button',{name:'检查生成配置',exact:true}).click();await edit.getByText('配置检查通过',{exact:true}).waitFor();assert.equal(submits.length,beforeOperator,'operator preflight generated a task');
 await edit.getByText('配置检查通过',{exact:true}).scrollIntoViewIfNeeded();await snap('operator-check-desktop');await page.setViewportSize({width:390,height:844});await edit.getByText('配置检查通过',{exact:true}).scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await snap('operator-check-mobile');await page.setViewportSize({width:1440,height:1000});
 await edit.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('alertdialog',{name:'放弃未保存的修改？'}).getByRole('button',{name:'取消',exact:true}).click();assert.equal(await edit.getByLabel('分辨率',{exact:true}).inputValue(),'2k');
 await edit.getByRole('button',{name:'展示状态',exact:true}).click();await page.getByRole('option',{name:'上架到灵感和模板',exact:true}).click();await edit.getByRole('button',{name:'保存并上架',exact:true}).click();await page.getByRole('heading',{name:'运营测试风格',exact:true}).waitFor();
 await page.getByRole('button',{name:'复制运营测试风格',exact:true}).click();const clone=page.getByRole('dialog',{name:'新建创作模板'});assert.equal(await clone.getByLabel(/^名称/).inputValue(),'运营测试风格（副本）');assert.equal(await clone.getByLabel(/完整提示词/).inputValue(),'admin-only-recipe');await clone.getByLabel(/^名称/).fill('复制后的新同款');await clone.getByRole('button',{name:'保存草稿',exact:true}).click();await page.getByRole('heading',{name:'复制后的新同款',exact:true}).waitFor();assert.equal(templates.at(-1).status,0);assert.notEqual(templates.at(-1).id,operatorRow.id);assert.equal(operatorRow.title,'运营测试风格');
 await page.goto(base+'/templates/'+operatorRow.id,{waitUntil:'networkidle'});await page.getByLabel('上传主体照片',{exact:true}).setInputFiles(imageFile);await page.getByText('7 积分',{exact:true}).waitFor();await page.getByRole('button',{name:'生成同款',exact:true}).click();await page.getByRole('heading',{name:'你的同款，完成了'}).waitFor();assert.equal(submits.at(-1).templateId,operatorRow.id);assert.equal('prompt' in submits.at(-1).input,false);
 await page.goto(base+'/admin/studio-templates',{waitUntil:'networkidle'});await page.getByRole('button',{name:'新建风格',exact:true}).click();const unfinished=page.getByRole('dialog',{name:'新建创作模板'});await unfinished.getByLabel(/^名称/).fill('尚未填提示词的草稿');await unfinished.getByRole('button',{name:'保存草稿',exact:true}).click();await page.getByRole('heading',{name:'尚未填提示词的草稿',exact:true}).waitFor();
 await page.getByRole('button',{name:'从用户作品导入',exact:true}).click();await page.getByRole('button',{name:'导入为灵感草稿',exact:true}).click();assert.equal(await page.getByRole('dialog',{name:'编辑创作模板'}).getByLabel(/完整提示词/).inputValue(),'导入的运营提示词');
 assert.deepEqual(errors,[]);console.log('PASS: prompt-free gallery/workshop and static assets, repeated active filters, owned image/video/audio IDs, quotes, ambiguous retry, refresh/unpublished/deleted-task recovery, account isolation, working Studio, admin edit/import, desktop/mobile.');
}catch(error){console.log(JSON.stringify({url:page.url(),body:(await page.locator('body').innerText().catch(()=>'')),errors}));throw error;}finally{await browser.close();}
