import test from "node:test";
import assert from "node:assert/strict";
import { checkoutUrl, directCheckoutUrl } from "../src/lib/billing.ts";
test("Pancake checkout is bound to USD and its exact secure hosted origin", () => {
 const url="https://checkout.waffo.ai/framelyn/checkout/cs_123#token=signed";
 assert.equal(checkoutUrl({payMethod:"pancake",currency:"USD",payUrl:url}),url);
 const actualUrl="https://pancake.waffo.ai/store/framelyn/checkout/cs_123#token=signed";
 assert.equal(checkoutUrl({payMethod:"pancake",currency:"USD",payUrl:actualUrl}),actualUrl);
 for(const payUrl of ["https://pancake.waffo.ai.evil.test/pay","https://user@pancake.waffo.ai/pay","http://pancake.waffo.ai/pay","https://pancake.waffo.ai:8443/pay"]) assert.equal(checkoutUrl({payMethod:"pancake",currency:"USD",payUrl}),"");
 for(const payUrl of ["http://checkout.waffo.ai/pay","https://checkout.waffo.ai.evil.test/pay","https://user@checkout.waffo.ai/pay","https://checkout.waffo.ai:8443/pay","https://checkout.stripe.com/pay","javascript:alert(1)"]) assert.equal(checkoutUrl({payMethod:"pancake",currency:"USD",payUrl}),"");
 assert.equal(checkoutUrl({payMethod:"pancake",currency:"CNY",payUrl:url}),"");
 assert.equal(checkoutUrl({payMethod:"stripe",currency:"USD",payUrl:url}),"");
});
test("Pancake purchases use the invoice/new-tab flow rather than Stripe's same-tab shortcut",()=>{
 const plan={id:"801",market:"en",currency:"USD",monthly:10,yearly:100,monthlyPoints:600};
 assert.equal(directCheckoutUrl({id:"901",planId:"801",market:"en",currency:"USD",payMethod:"pancake",status:0,cycle:"monthly",amount:10,credits:600,checkoutAvailable:true,payUrl:"https://checkout.waffo.ai/x"},plan,"monthly"),"");
});
