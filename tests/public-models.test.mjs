import test from "node:test";
import assert from "node:assert/strict";
import { publicMediaModels } from "../src/lib/public-models.ts";

test("public disclosure uses only actual media catalogue entries and preserves model names",()=>{
 const rows=[{id:"1",name:"GPT Image 2",modelKey:"gpt-image-2",type:"image",pointCost:"4",internalSecret:"not-public"},
 {id:"2",name:"Text model",modelKey:"text-only",type:"text"},
 {id:"3",name:"Wan 3.0 Video",modelKey:"wan3.0-video",type:"video"},
 {id:"1",name:"Duplicate",modelKey:"same",type:"image"}];
 const result=publicMediaModels(rows);
 assert.deepEqual(result.map(r=>r.name),["GPT Image 2","Wan 3.0 Video"]);
 assert.equal("internalSecret" in result[0],false);
 assert.equal(result[0].modelKey,"gpt-image-2");
});
test("unavailable or malformed public catalogues never invent model names",()=>{
 for(const value of [null,{},"unavailable",[null,{type:"image"},{id:1,name:"Bad ID",modelKey:"bad",type:"video"}]]) assert.deepEqual(publicMediaModels(value),[]);
});
