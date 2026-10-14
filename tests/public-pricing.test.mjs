import test from "node:test";
import assert from "node:assert/strict";
import { publicPricingPlans, pricingExamples } from "../src/lib/public-pricing.ts";

const plan = {id:"en",name:"Creator",market:"en",currency:"USD",monthly:10,yearly:100,monthlyPoints:600,items:[]};
test("public pricing distinguishes missing data, empty catalogue, wrong currency and invalid prices",()=>{
 assert.equal(publicPricingPlans(null),null);
 assert.deepEqual(publicPricingPlans([]),[]);
 assert.deepEqual(publicPricingPlans([{...plan,currency:"CNY"}]),[]);
 assert.deepEqual(publicPricingPlans([plan]),[plan]);
 for(const patch of [{monthly:NaN},{monthly:"10"},{monthly:-1},{monthlyPoints:Infinity},{monthlyPoints:0.5},{promo:{monthly:NaN,yearly:0}}]) assert.equal(publicPricingPlans([{...plan,...patch}]),null);
});
test("published examples reuse model billing rules and describe exact settings without fabricated costs",()=>{
 const models=[
  {id:"image",name:"Image",modelKey:"image",type:"image",pointCost:"4",config:{resolutions:["2k"],qualities:["high"],priceMatrix:{high:{"2k":8}}}},
  {id:"video",name:"Video",modelKey:"video",type:"video",pointCost:"1",config:{durations:["5s"],resolutions:["720p"],priceMatrix:{"5":{"720p":25}}}},
  {id:"audio",name:"Audio",modelKey:"audio",type:"audio",pointCost:"3",config:{}},
  {id:"text",name:"Text",modelKey:"text",type:"text",pointCost:"2",config:{}},
  {id:"unknown",name:"Unknown",modelKey:"unknown",type:"image",pointCost:"0",config:{}},
 ];
 const examples=pricingExamples(models);
 assert.deepEqual(examples.map(e=>e.credits),[8,25,3]);
 assert.match(examples[0].settings,/2k.*high/);assert.match(examples[1].settings,/5-second video.*720p/);
 assert.deepEqual(pricingExamples([{...models[0],config:{availabilityStatus:"maintenance"}}]),[]);
 assert.deepEqual(pricingExamples([{...models[1],config:{videoBillingMode:"per_request",resolutions:["720p"],pricePerRequestByResolution:{"720p":40}}}]).map(e=>e.credits),[40]);
});
