import assert from "node:assert/strict";
import test from "node:test";
import { readTemplateDraft, saveTemplateDraft, templateDraftSignature } from "./template-draft.ts";
import { templateFilters, templateListURL, templateReturnURL } from "./template-navigation.ts";
import { templateUploadSlots, templateOutputText, templateResultURLs } from "./template-workshop.ts";
import { copyTemplateDraft, templateCountRange, templateSpecChoices, templateParameterFields, templateOptionsForModel, templateOptionsForRequest } from "./template-operator.ts";
import { modelGenerationOptions } from "./model-generation-options.mjs";

test("template parameters use Studio configuration with media-specific visibility and defaults",()=>{
 const image={ratios:['1:1','9:16'],resolutions:['4k','1k','2k'],qualities:['high','low'],durations:['10s','4.5s'],batchOptions:[1,4]};
 assert.deepEqual(templateParameterFields('image',image).map(f=>f.key),['aspectRatio','resolution','quality','batchCount']);
 assert.deepEqual(templateParameterFields('video',image).map(f=>f.key),['aspectRatio','resolution','duration']);
 assert.deepEqual(templateParameterFields('image',{ratios:['1:1'],hideBatchCount:true}).map(f=>f.key),['aspectRatio']);
 assert.deepEqual(templateParameterFields('video',{}),[]);
 const shared=modelGenerationOptions(image);assert.deepEqual(shared.resDisplay,['1k','2k','4k']);assert.equal(shared.resolutions[0],'4k');assert.deepEqual(shared.durDisplay,['4.5s','10s']);
 assert.deepEqual(templateOptionsForModel({aspectRatio:'9:16',resolution:'2k',quality:'high',duration:10,batchCount:4},'image',{ratios:['9:16'],hideBatchCount:true}),{aspectRatio:'9:16'});
 assert.deepEqual(templateOptionsForModel({aspectRatio:'1:1',resolution:'2K',quality:'high',duration:4.5,batchCount:4},'video',image),{aspectRatio:'1:1',resolution:'2k',duration:4.5});
});

test("multi-image template results keep every downloadable URL without trusting other metadata",()=>{
 const main='https://cdn.test/one.png',second='https://cdn.test/two.png';
 assert.deepEqual(templateResultURLs({resultUrl:main,resultMeta:JSON.stringify({urls:[main,second,'javascript:alert(1)',null],prompt:'private'})}),[main,second]);
 assert.deepEqual(templateResultURLs({resultUrl:main,resultMeta:'broken'}),[main]);
 assert.ok(templateOutputText({batchCount:3}).includes('3 张'));
});

test("operator submits visible defaults explicitly even when API duration ordering differs from storage",()=>{
 const raw={durations:['10s','4.5s'],resolutions:['1080p','720p'],ratios:['16:9','9:16']};
 const api={...raw,durations:['4.5s','10s']};
 assert.deepEqual(templateOptionsForRequest({},'video',api),{aspectRatio:'16:9',resolution:'1080p',duration:4.5});
 assert.equal(templateOptionsForRequest({duration:10},'video',api).duration,10);
 assert.equal(templateOptionsForRequest({duration:99},'video',api).duration,99,'keep invalid selection for server validation');
 assert.deepEqual(templateOptionsForRequest({quality:'high',batchCount:3},'video',api),{aspectRatio:'16:9',resolution:'1080p',duration:4.5});
 assert.deepEqual(templateOptionsForRequest({},'image',{resolutions:['4k','2k'],qualities:['high'],hideBatchCount:true}),{resolution:'4k',quality:'high'});
});

test("switching a 30s recipe to a short-video model cannot silently shorten its timeline",()=>{
 const short={durations:['5s','15s'],ratios:['9:16']};
 const switched=templateOptionsForModel({duration:30,aspectRatio:'9:16'},'video',short);
 assert.equal(switched.duration,30);
 assert.equal(templateSpecChoices(String(switched.duration),['5','15']).invalid,true);
 assert.equal(templateOptionsForRequest(switched,'video',short).duration,30);
 const unavailable=templateOptionsForModel(switched,'video',{});
 assert.equal(templateOptionsForRequest(unavailable,'video',{}).duration,30);
 assert.equal(templateOptionsForRequest({...switched,duration:undefined},'video',short).duration,5,'explicitly choosing model default remains possible');
});

test("numeric legacy durations remain selectable and malformed batch config does not crash the page",()=>{
 assert.deepEqual(modelGenerationOptions({durations:[5,4.5,'10S',null,-1,'broken']}).durDisplay,['4.5s','5s','10S']);
 assert.deepEqual(templateParameterFields('video',{durations:[5,4.5]}).find(f=>f.key==='duration').values,['5','4.5']);
 assert.deepEqual(modelGenerationOptions({batchOptions:{},hideBatchCount:'false'}).batchChoices,[1,2,3,4]);
});

const recipe={mode:"i2i",requirements:{images:2,videos:0,audio:0},inputLabels:{images:["人物照片","服装图片"]}};
const file={id:"9007199254740993123",ownerId:"7",fileUrl:"https://cdn.test/me.png",originalName:"me.png",fileSize:8,fileType:"image",mimeType:"image/png"};
const memory=()=>{const data=new Map();return {data,getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};};

test("model spec selectors preserve unsupported values and never invent an allowed list",()=>{
 const invalid=templateSpecChoices('4:5',['1:1','16:9']);
 assert.equal(invalid.invalid,true);assert.equal(invalid.value,'4:5');
 assert.equal(invalid.options.find(item=>item.value==='4:5').disabled,true);
 assert.equal(templateSpecChoices('', ['1:1']).value,'');
 const canonical=templateSpecChoices(' HIGH ',['high','HIGH','',null]);
 assert.equal(canonical.invalid,false);assert.equal(canonical.value,'high');assert.equal(canonical.options.length,2);
 for(const unknown of [undefined,[],null,'1:1']){
  const result=templateSpecChoices('4:5',unknown);assert.equal(result.constrained,false);assert.equal(result.invalid,false);assert.equal(result.value,'4:5');
 }
});

test("operator clones are isolated unpublished recipes without source identity or counters",()=>{
 const row={...recipe,id:"123",kind:"inspiration",mediaType:"image",title:"同款",status:1,uses:50,prompt:"private",modelKey:"pinned",options:{resolution:"2k"},sourceKey:"task:123"};
 const copy=copyTemplateDraft(row);
 assert.equal(copy.status,0);assert.equal(copy.title,"同款（副本）");assert.equal(copy.modelKey,"pinned");
 for(const key of ["id","uses","sourceKey"])assert.equal(key in copy,false);
 copy.inputLabels.images[0]="新角色";copy.requirements.images=1;copy.options.resolution="4k";
 assert.equal(row.inputLabels.images[0],"人物照片");assert.equal(row.requirements.images,2);assert.equal(row.options.resolution,"2k");
 assert.deepEqual(templateCountRange("i2v","images"),{min:1,max:1});
 assert.deepEqual(templateCountRange("flf","images"),{min:2,max:2});
 assert.deepEqual(templateCountRange("t2i","images"),{min:0,max:0});
 assert.deepEqual(templateCountRange("ref","audio"),{min:0,max:3});
});

test("drafts recover uploaded references only for the same account and recipe",()=>{
 const storage=memory(),signature=templateDraftSignature(recipe);
 assert.equal(saveTemplateDraft("7","12",signature,{"image-0":{...file,secret:"never-store"}},storage),true);
 const saved=readTemplateDraft("7","12",signature,storage);
 assert.equal(saved.files["image-0"].id,file.id);assert.equal("secret" in saved.files["image-0"],false);
 assert.deepEqual(readTemplateDraft("8","12",signature,storage).files,{});
 assert.deepEqual(readTemplateDraft("7","13",signature,storage).files,{});
 const changed=readTemplateDraft("7","12",templateDraftSignature({...recipe,mode:"flf"}),storage);
 assert.equal(changed.changed,true);assert.deepEqual(changed.files,{});
 const changedOptional=readTemplateDraft("7","12",templateDraftSignature({...recipe,requirements:{...recipe.requirements,optionalImages:[2]}}),storage);
 assert.equal(changedOptional.changed,true);assert.deepEqual(changedOptional.files,{});
 saveTemplateDraft("7","12",signature,{},storage);assert.deepEqual(readTemplateDraft("7","12",signature,storage).files,{});
});
test("expired, corrupted and unavailable browser storage cannot authorize a generation",()=>{
 const storage=memory(),signature=templateDraftSignature(recipe);
 saveTemplateDraft("7","12",signature,{"image-0":file},storage);
 const [key,raw]=[...storage.data][0];const value=JSON.parse(raw);value.updatedAt=0;storage.setItem(key,JSON.stringify(value));
 assert.deepEqual(readTemplateDraft("7","12",signature,storage).files,{});
 storage.setItem(key,"broken");assert.deepEqual(readTemplateDraft("7","12",signature,storage).files,{});
 assert.equal(saveTemplateDraft("7","12",signature,{"image-0":file},{setItem(){throw new Error('quota');}}),false);
});
test("list filters survive shareable URLs and return destinations stay inside template list",()=>{
 const expected={media:"image",category:"人物换装",keyword:"雨 夜",page:3};
 const url=templateListURL(expected);assert.deepEqual(templateFilters(new URL(url,"https://local.test").searchParams),expected);
 assert.equal(templateReturnURL(url),url);
 for(const unsafe of ["https://evil.test/templates","//evil.test/templates","/templates/../admin","javascript:alert(1)","/templates#bad"]) assert.equal(templateReturnURL(unsafe),"/templates");
 assert.deepEqual(templateFilters(new URLSearchParams("type=text&page=-3")),{media:"",category:"",keyword:"",page:1});
});
test("upload roles are operator-supplied and effective output options are explicit",()=>{
 assert.deepEqual(templateUploadSlots(recipe).map(slot=>slot.label),["人物照片","服装图片"]);
 assert.deepEqual(templateUploadSlots({...recipe,inputLabels:undefined}).map(slot=>slot.label),["图片1","图片2"]);
 assert.equal(templateOutputText({resolution:"1080p",aspectRatio:"16:9",duration:5}),"1080p · 比例 16:9 · 5 秒");
 assert.equal(templateOutputText(),"规格待确认");
});
