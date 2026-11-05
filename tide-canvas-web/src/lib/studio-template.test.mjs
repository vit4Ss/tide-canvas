import assert from "node:assert/strict";
import test from "node:test";
import { templateInputs, templateModelChoices } from "./studio-template.ts";
import { templateUploadSlots, templateUploadInput, templateUploadsReady } from "./template-workshop.ts";
const recipe = (mode, images = 0, videos = 0, audio = 0) => ({ mode, requirements: { images, videos, audio } });
test("image templates require their own complete references and preserve ordered slots", () => {
  const row = recipe("i2i", 2), slots = templateUploadSlots(row);
  assert.equal(templateUploadsReady(row, slots, { "image-0": { id: "9007199254740993123" } }), false);
  const files = { "image-0": { id: "9007199254740993123" }, "image-1": { id: "92" }, "video-0": { id: "unrelated" } };
  assert.equal(templateUploadsReady(row, slots, files), true);
  assert.deepEqual(templateUploadInput(slots, files), { imageIds: ["9007199254740993123", "92"], videoIds: [], audioIds: [] });
});
test("first and last frame positions survive a missing first frame", () => {
  const row = recipe("flf"), slots = templateUploadSlots(row);
  assert.deepEqual(slots.map(s => s.label), ["首帧图片", "尾帧图片"]);
  assert.equal(templateUploadsReady(row, slots, { "image-1": { id: "last" } }), false);
});
test("reference video accepts owned video plus audio only when both requirements are met", () => {
  const row = recipe("ref", 0, 1, 1), slots = templateUploadSlots(row);
  assert.equal(templateUploadsReady(row, slots, { "video-0": { id: "video" } }), false);
  assert.equal(templateUploadsReady(row, slots, { "video-0": { id: "video" }, "audio-0": { id: "audio" } }), true);
  assert.equal(templateInputs(row), "1 段视频 + 1 段音频");
});
test("flexible reference templates still require one asset; ready-made text templates do not", () => {
  const row = recipe("ref"), slots = templateUploadSlots(row);
  assert.ok(slots.every(s => s.optional));
  assert.equal(templateUploadsReady(row, slots, {}), false);
  assert.equal(templateUploadsReady(row, slots, { "audio-0": { id: "audio" } }), true);
  const text = recipe("t2i");
  assert.deepEqual(templateUploadSlots(text), []);
  assert.equal(templateUploadsReady(text, [], {}), true);
  assert.equal(templateInputs(text), "无需上传素材");
});
test("image-to-video automatically exposes the mandatory first image", () => {
  assert.equal(templateUploadSlots(recipe("i2v")).length, 1);
});

test("model choices ignore template resolution because users choose per model", () => {
  const row = { mediaType: "image", mode: "i2i", requirements: { images: 1, videos: 0, audio: 0 }, options: { aspectRatio: "4:5", resolution: "2k", quality: "high" } };
  const models = [
    { id: "1", name: "Compatible", modelKey: "ok", type: "image", desc: "", pointCost: "7", config: { modes: ["i2i"], ratios: ["4:5"], resolutions: ["2k"], qualities: ["high"] } },
    { id: "2", name: "Wrong mode", modelKey: "t2i", type: "image", desc: "", pointCost: "5", config: { modes: ["t2i"] } },
    { id: "3", name: "Wrong ratio", modelKey: "square", type: "image", desc: "", pointCost: "5", config: { modes: ["i2i"], ratios: ["1:1"] } },
    { id: "4", name: "Maintenance", modelKey: "paused", type: "image", desc: "", pointCost: "5", config: { modes: ["i2i"], availabilityStatus: "maintenance" } },
    { id: "5", name: "Different resolution", modelKey: "4k-only", type: "image", desc: "", pointCost: "9", config: { modes: ["i2i"], ratios: ["4:5"], resolutions: ["4k"], qualities: ["high"] } },
  ];
  assert.deepEqual(templateModelChoices(row, models).map(model => model.id), ["1", "5"]);
});

test("optional portrait does not shift product and workshop image positions",()=>{
 const row={mode:'ref',requirements:{images:6,videos:0,audio:0,optionalImages:[3,6]},inputLabels:{images:['入口','接待区','本人头像','产品','车间','工序']}};
 const slots=templateUploadSlots(row);
 assert.equal(slots.length,6);assert.deepEqual(slots.map(s=>s.optional),[false,false,true,false,false,true]);
 const files={'image-0':{id:'1'},'image-1':{id:'2'},'image-3':{id:'4'},'image-4':{id:'5'}};
 assert.equal(templateUploadsReady(row,slots,files),true);
 assert.deepEqual(templateUploadInput(slots,files),{imageIds:['1','2','4','5'],videoIds:[],audioIds:[],imageSlots:[1,2,4,5]});
 assert.equal(templateUploadsReady(row,slots,{'image-0':{id:'1'},'image-1':{id:'2'}}),false);
 assert.equal(templateInputs(row),'4 张必填图片 + 2 张选填图片');
});
