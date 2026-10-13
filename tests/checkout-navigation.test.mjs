import test from "node:test";
import assert from "node:assert/strict";
import { directCheckoutUrl, purchaseChanged } from "../src/lib/billing.ts";
const plan={id:"801",market:"en",currency:"USD",monthly:12,yearly:120,monthlyPoints:600};
const order={id:"901",planId:"801",market:"en",currency:"USD",payMethod:"stripe",status:0,cycle:"monthly",amount:12,credits:600,checkoutAvailable:true,payUrl:"https://checkout.stripe.com/c/pay/cs_test_fixture"};
test("only a new matching, enabled Stripe order can go straight to checkout",()=>{
 assert.equal(directCheckoutUrl(order,plan,"monthly"),order.payUrl);
 for(const change of [{amount:13},{credits:601},{planId:"802"},{cycle:"yearly"},{currency:"CNY"},{market:"cn"},{existingCheckout:true},{paymentProcessing:true},{status:1},{checkoutAvailable:false},{payUrl:"https://example.test/pay"},{credits:undefined},{planId:undefined}]) assert.equal(directCheckoutUrl({...order,...change},plan,"monthly"),"",JSON.stringify(change));
});
test("price, credit and purchase changes require an explicit order review",()=>{
 assert.equal(purchaseChanged(order,plan,"monthly"),false);
 assert.equal(purchaseChanged({...order,amount:13},plan,"monthly"),true);
 assert.equal(purchaseChanged({...order,credits:700},plan,"monthly"),true);
 assert.equal(purchaseChanged({...order,cycle:"yearly"},plan,"monthly"),true);
 assert.equal(directCheckoutUrl({...order,cycle:"yearly",amount:120,credits:7200},plan,"yearly"),order.payUrl);
});
