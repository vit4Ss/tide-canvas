import assert from "node:assert/strict";
import test from "node:test";
import { requestCanvasSave } from "./canvas-save.ts";

class TestCustomEvent {
  constructor(type, init) { this.type = type; this.detail = init.detail; }
}

test("a save requested just before listener registration is retried", async (t) => {
  const previousWindow = globalThis.window;
  const previousCustomEvent = globalThis.CustomEvent;
  let dispatches = 0;
  globalThis.CustomEvent = TestCustomEvent;
  globalThis.window = {
    dispatchEvent(event) {
      dispatches += 1;
      if (dispatches === 2) {
        event.detail.handled = true;
        queueMicrotask(() => event.detail.acknowledge(true));
      }
      return true;
    },
  };
  t.after(() => {
    globalThis.window = previousWindow;
    globalThis.CustomEvent = previousCustomEvent;
  });
  assert.equal(await requestCanvasSave("project"), true);
  assert.equal(dispatches, 2);
});

test("dispatch exceptions fail safely instead of leaving generation pending", async (t) => {
  const previousWindow = globalThis.window;
  const previousCustomEvent = globalThis.CustomEvent;
  globalThis.CustomEvent = TestCustomEvent;
  globalThis.window = { dispatchEvent() { throw new Error("extension failure"); } };
  t.after(() => {
    globalThis.window = previousWindow;
    globalThis.CustomEvent = previousCustomEvent;
  });
  assert.equal(await requestCanvasSave("project"), false);
});
