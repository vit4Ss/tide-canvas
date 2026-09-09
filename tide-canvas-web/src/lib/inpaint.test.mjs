import assert from "node:assert/strict";
import test from "node:test";
import { chooseInpaintModel, defaultInpaintQuality, defaultInpaintResolution, paintMask, renderMaskPreview, sourceBrushSize } from "./inpaint.ts";

test("inpainting uses the first available admin-configured mask model only", () => {
  const models = [
    {id:"1",type:"image",modelKey:"ordinary",config:{}},
    {id:"2",type:"image",modelKey:"maintenance",config:{supportsMask:true,availabilityStatus:"maintenance"}},
    {id:"3",type:"image",modelKey:"primary",config:{supportsMask:true}},
    {id:"4",type:"image",modelKey:"secondary",config:{supportsMask:true}},
  ];
  assert.equal(chooseInpaintModel(models)?.id,"3");
  assert.equal(chooseInpaintModel(models.slice(0,2)),null);
  assert.equal(chooseInpaintModel([{...models[2],type:"video"}]),null);
});

test("hidden inpaint settings prefer 4K and high without submitting unsupported values", () => {
  assert.equal(defaultInpaintResolution(), "4k");
  assert.equal(defaultInpaintResolution(["1k", "4K", "2k"]), "4K");
  assert.equal(defaultInpaintResolution(["1k", "2k"]), "2k");
  assert.equal(defaultInpaintQuality(), "high");
  assert.equal(defaultInpaintQuality(["low", "HIGH", "medium"]), "HIGH");
  assert.equal(defaultInpaintQuality(["low", "medium"]), "medium");
});

test("brush size stays visually stable when responsive layout further shrinks the image", () => {
  assert.equal(sourceBrushSize(40,3840,960),160);
  assert.equal(sourceBrushSize(40,3840,480),320);
  assert.equal(sourceBrushSize(40,0,0),1);
});

test("mask candidates must also accept edits and share backend maintenance normalization", () => {
  const model={id:"a",type:"image",modelKey:"image",config:{supportsMask:true}};
  assert.equal(chooseInpaintModel([{...model,config:{...model.config,supportedHandlers:["text_to_image"]}}]),null);
  assert.equal(chooseInpaintModel([{...model,config:{...model.config,availabilityStatus:" MAINTENANCE "}}]),null);
  assert.equal(chooseInpaintModel([{...model,config:{...model.config,supportedHandlers:"text_to_image, image_to_image"}}])?.id,"a");
  assert.equal(chooseInpaintModel([{...model,modelKey:" "}]),null);
});

test("submission redraws the authoritative selection before checking an erased mask", () => {
  let selected=false;
  const ctx={
    setTransform(){},clearRect(){selected=false;},scale(){},beginPath(){},arc(){},
    fill(){selected=this.globalCompositeOperation!=="destination-out";},
    getImageData(){return {data:new Uint8ClampedArray([0,0,0,selected?255:0])};},
  };
  const canvas={width:1,height:1,getContext(){return ctx;}};
  const strokes=[{erase:false,size:60,points:[{x:600,y:300}]}];
  renderMaskPreview(canvas,1200,600,strokes);
  assert.equal(ctx.getImageData().data[3],255);
  // Erase and click submit before the next animation frame has painted.
  strokes.push({...strokes[0],erase:true});
  const current=renderMaskPreview(canvas,1200,600,strokes);
  assert.equal(current.getImageData().data[3],0);
});

test("export uses transparent edit pixels and opaque erased pixels at source coordinates", () => {
  const operations=[];
  const ctx={beginPath(){},arc(...args){operations.push([this.globalCompositeOperation,this.fillStyle,...args]);},fill(){},stroke(){},moveTo(){},lineTo(){}};
  paintMask(ctx,[
    {erase:false,size:60,points:[{x:600,y:300}]},
    {erase:true,size:20,points:[{x:620,y:300}]},
  ],true);
  assert.equal(operations[0][0],"destination-out");
  assert.deepEqual(operations[0].slice(2,5),[600,300,30]);
  assert.equal(operations[1][0],"source-over");
  assert.equal(ctx.globalCompositeOperation,"source-over");
});
