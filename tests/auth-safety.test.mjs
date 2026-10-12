import assert from "node:assert/strict";
import test from "node:test";
import { googleAuthRequest } from "../src/lib/google-auth.ts";
import { sessionOwner, setTokens } from "../src/lib/http.ts";

test("Google exchange sends no website JWT and never automatically retries an auth rejection", async () => {
  const previous = globalThis.fetch; const calls = [];
  globalThis.fetch = async (path, init) => {
    calls.push({ path, init });
    return Response.json({ success: false, code: 401, message: "Credential rejected", data: null }, { status: 401 });
  };
  try {
    const result = await googleAuthRequest("/api/auth/google", { credential: "fixture", nonce: "a".repeat(43) });
    assert.equal(result.code, 401); assert.equal(calls.length, 1); assert.equal(new Headers(calls[0].init.headers).has("Authorization"), false);
    assert.equal(calls[0].init.credentials, "same-origin");
  } finally { globalThis.fetch = previous; }
});

test("cancelled Google exchanges settle without a session or an unhandled rejection", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async (_path, init) => { if (init.signal.aborted) throw new DOMException("Aborted", "AbortError"); return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })); };
  try {
    const controller = new AbortController(); const pending = googleAuthRequest("/api/auth/google", {}, controller.signal); controller.abort();
    const result = await pending; assert.equal(result.success, false); assert.equal(result.code, 0); assert.match(result.message, /interrupted or timed out/);
  } finally { globalThis.fetch = previous; }
});

test("failed browser storage writes cannot mix tokens from two accounts", () => {
  const previousStorage = globalThis.localStorage; const previousWindow = globalThis.window;
  const values = new Map([["access_token", "old-access"], ["refresh_token", "old-refresh"]]);
  let events = 0;
  globalThis.localStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { if (key === "access_token" && value === "new-access") throw new Error("quota"); values.set(key, value); }, removeItem: (key) => values.delete(key) };
  globalThis.window = { dispatchEvent: () => { events += 1; } };
  try {
    assert.throws(() => setTokens("new-access", "new-refresh"), /could not save your sign-in/);
    assert.equal(values.get("access_token"), "old-access"); assert.equal(values.get("refresh_token"), "old-refresh"); assert.equal(events, 0);
  } finally { globalThis.localStorage = previousStorage; globalThis.window = previousWindow; }
});

test("a failed token rollback clears the session and notifies account views", () => {
  const previousStorage = globalThis.localStorage; const previousWindow = globalThis.window;
  const values = new Map([["access_token", "old-access"], ["refresh_token", "old-refresh"]]); let events = 0;
  globalThis.localStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { if ((key === "access_token" && value === "new-access") || (key === "refresh_token" && value === "old-refresh")) throw new Error("storage"); values.set(key, value); }, removeItem: (key) => values.delete(key) };
  globalThis.window = { dispatchEvent: () => { events += 1; } };
  try {
    assert.throws(() => setTokens("new-access", "new-refresh"), /could not save your sign-in/);
    assert.equal(values.size, 0); assert.equal(events, 1);
  } finally { globalThis.localStorage = previousStorage; globalThis.window = previousWindow; }
});

test("draft retention distinguishes refreshed owner IDs without numeric precision loss", () => {
  const token = (uid) => `fixture.${Buffer.from(JSON.stringify({ uid })).toString("base64url")}.fixture`;
  assert.equal(sessionOwner(token("90071992547409930")), "90071992547409930");
  assert.notEqual(sessionOwner(token("90071992547409930")), sessionOwner(token("90071992547409931")));
  assert.equal(sessionOwner("malformed"), null); assert.equal(sessionOwner(null), null);
});
