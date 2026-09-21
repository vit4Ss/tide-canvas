import assert from "node:assert/strict";
import test from "node:test";
import { generationNetPoints, generationRefundNote } from "./generation-history-billing.ts";

test("generation history reports net cost even when a successful skill step is refunded", () => {
  assert.equal(generationNetPoints({pointCost:8,refundedPoints:8}),0);
  assert.equal(generationNetPoints({pointCost:8,refundedPoints:3}),5);
  assert.equal(generationNetPoints({pointCost:8,refundedPoints:0}),8);
  assert.equal(generationNetPoints({}),null);
  assert.equal(generationNetPoints({pointCost:8,refundedPoints:10}),0);
});

test("failure alone is not evidence of refund", () => {
  assert.match(generationRefundNote({pointCost:8,refundedPoints:0}),/实际扣费和退款/);
  assert.match(generationRefundNote({pointCost:8,refundedPoints:8}),/已退回 8/);
  assert.match(generationRefundNote({pointCost:0}),/未扣除/);
});
