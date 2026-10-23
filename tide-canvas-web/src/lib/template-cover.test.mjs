import assert from "node:assert/strict";
import test from "node:test";
import { buildTemplateCoverPrompt, canFillTemplateCover, templateCoverModels, templateCoverInput, templateCoverResult } from "./template-cover.ts";
import { resolveImageToolPointCost } from "./price-matrix.ts";

test("cover brief uses presentation text and excludes the private recipe and reference tokens",()=>{
 const prompt=buildTemplateCoverPrompt({title:'火锅店真人带看 · 15秒',description:'暖色店内、餐桌与锅面蒸汽',category:'餐饮探店',prompt:'PRIVATE_RECIPE {{image:3}}'});
 assert.ok(prompt.includes('火锅店'));assert.ok(prompt.includes('暖色'));assert.ok(prompt.includes('静态图片'));
 assert.ok(!prompt.includes('PRIVATE_RECIPE'));assert.ok(!prompt.includes('{{image:3}}'));
 assert.ok(prompt.includes('不宣称是实际门店'));
});

test("only available text-to-image models are offered and configured primary is preferred",()=>{
 const m=(id,config={},patch={})=>({id,modelId:id,name:id,type:'image',config:JSON.stringify(config),...patch});
 const models=[m('ordinary'),m('edit-only',{modes:['i2i']}),m('maintenance',{availabilityStatus:'maintenance'}),m('primary',{imagePrimary:true,modes:['t2i']}),m('video',{}, {type:'video'}),m('handler-edit',{}, {supportedHandlers:['image_to_image']})];
 assert.deepEqual(templateCoverModels(models).map(v=>v.modelId),['primary','ordinary']);
});

test("single-cover specs and shown estimate use the actual configured quality/resolution",()=>{
 const model={modelId:'image',type:'image',pointCost:3,config:JSON.stringify({ratios:['1:1','16:9'],resolutions:['2k'],qualities:['high'],priceMatrix:{high:{'2k':11}}})};
 const input=templateCoverInput(model,' cover ');
 assert.deepEqual(input,{prompt:'cover',batchCount:1,aspectRatio:'16:9',resolution:'2k',quality:'high'});
 assert.equal(resolveImageToolPointCost(JSON.parse(model.config),input,model.pointCost),11);
 assert.deepEqual(templateCoverInput({...model,config:'{}'},'cover'),{prompt:'cover',batchCount:1});
});

test("cover results accept usable image URLs only, with optional metadata fallback",()=>{
 assert.equal(templateCoverResult({resultUrl:'javascript:alert(1)',resultMeta:{urls:['https://cdn.test/cover.webp']}}),'https://cdn.test/cover.webp');
 assert.equal(templateCoverResult({resultUrl:'https://cdn.test/cover.webp',resultMeta:'broken'}),'https://cdn.test/cover.webp');
 assert.equal(templateCoverResult({resultUrl:'',resultMeta:'broken'}),'');
});

test("automatic fill preserves edits and handles old recovery records conservatively",()=>{
 assert.equal(canFillTemplateCover('', '', 'hotpot', 'hotpot'),true);
 assert.equal(canFillTemplateCover('/old.webp', '/old.webp', 'hotpot', 'hotpot'),true);
 assert.equal(canFillTemplateCover('/manual.webp', '/old.webp', 'hotpot', 'hotpot'),false);
 assert.equal(canFillTemplateCover('', '/old.webp', 'hotpot', 'hotpot'),false);
 assert.equal(canFillTemplateCover('', '', 'bakery', 'hotpot'),false);
 assert.equal(canFillTemplateCover('', undefined, 'hotpot', 'hotpot'),true);
 assert.equal(canFillTemplateCover('/manual.webp', undefined, 'hotpot', 'hotpot'),false);
 assert.equal(canFillTemplateCover('', '/unsaved-upload.webp', 'hotpot', 'hotpot',''),true);
 assert.equal(canFillTemplateCover('/manual.webp', '/unsaved-upload.webp', 'hotpot', 'hotpot',''),false);
});
