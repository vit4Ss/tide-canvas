import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./use-auth-store.ts", import.meta.url), "utf8");
const body = source.slice(source.indexOf("export const useAuthStore =")).replace("export const", "const");
const code = ts.transpileModule(`let fetchUserPromise = null; let ensureSessionPromise = null; ${body}\nglobalThis.store = useAuthStore;`, {
  compilerOptions: {target: ts.ScriptTarget.ES2022},
}).outputText;

function setup() {
  const responses = [];
  const context = vm.createContext({
    window: {}, localStorage: {getItem: () => "test-token"},
    authApi: {me: () => new Promise(resolve => responses.push(resolve))},
    create: initializer => {
      let state;
      state = initializer(patch => Object.assign(state, patch), () => state);
      return state;
    },
  });
  vm.runInContext(code, context);
  return {store: context.store, responses};
}

test("normal concurrent profile requests still share one network call", async () => {
  const {store, responses} = setup();
  const first = store.fetchUser(), second = store.fetchUser();
  assert.equal(first, second);
  assert.equal(responses.length, 1);
  responses[0]({success: true, data: {id: "user", points: 5}});
  await Promise.all([first, second]);
  assert.equal(store.user.points, 5);
});

test("post-charge and post-refund refreshes cannot reuse an older balance response", async () => {
  const {store, responses} = setup();
  const initial = store.fetchUser();
  const afterCharge = store.fetchUser(true), historyRefresh = store.fetchUser(true);
  assert.equal(responses.length, 1);
  responses[0]({success: true, data: {id: "user", points: 5}});
  await initial;
  await Promise.resolve();
  assert.equal(responses.length, 2);
  responses[1]({success: true, data: {id: "user", points: 0}});
  await Promise.all([afterCharge, historyRefresh]);
  assert.equal(store.user.points, 0);
  assert.equal(responses.length, 2);

  const beforeRefund = store.fetchUser();
  const afterRefund = store.fetchUser(true);
  responses[2]({success: true, data: {id: "user", points: 0}});
  await beforeRefund;
  await Promise.resolve();
  responses[3]({success: true, data: {id: "user", points: 5}});
  await afterRefund;
  assert.equal(store.user.points, 5);
});
