import assert from "node:assert/strict";
import test from "node:test";
import { resolveRuntimeConfig } from "../src/lib/runtime-config.ts";

test("production and test read their own runtime backend and public settings", () => {
  const prod = resolveRuntimeConfig({ APP_ENV: "prod", BACKEND_URL: "http://127.0.0.1:8081", SITE_URL: "https://en.example.com/", GOOGLE_CLIENT_ID: "production-client" });
  const staging = resolveRuntimeConfig({ APP_ENV: "test", BACKEND_URL: "https://test-flowlight.example.com", SITE_URL: "https://test-en.example.com", GOOGLE_CLIENT_ID: "test-client" });
  assert.equal(prod.environment, "prod"); assert.equal(staging.environment, "test");
  assert.equal(prod.publicConfig.siteUrl, "https://en.example.com"); assert.notEqual(prod.backendUrl, staging.backendUrl);
  assert.equal(staging.publicConfig.googleClientId, "test-client");
});
test("only explicitly public values leave the server", () => {
  const config = resolveRuntimeConfig({ BACKEND_URL: "http://private-backend:8081", TIDECANVAS_JWT_SECRET: "private-sentinel", TIDECANVAS_RELAY_APIKEY: "private-sentinel", GOOGLE_CLIENT_SECRET: "private-sentinel", SOME_EXTRA: "private-sentinel" });
  const publicJSON = JSON.stringify(config.publicConfig);
  assert.equal(publicJSON.includes("private-sentinel"), false); assert.equal(publicJSON.includes("private-backend"), false);
});
test("runtime values override legacy local settings, including disabling Google", () => {
  const config = resolveRuntimeConfig({ GOOGLE_CLIENT_ID: "", NEXT_PUBLIC_GOOGLE_CLIENT_ID: "old-client", BRAND_NAME: "New brand", NEXT_PUBLIC_BRAND_NAME: "Old brand" });
  assert.equal(config.publicConfig.googleClientId, ""); assert.equal(config.publicConfig.name, "New brand");
  assert.equal(resolveRuntimeConfig({ NEXT_PUBLIC_GOOGLE_CLIENT_ID: "local-client" }).publicConfig.googleClientId, "local-client");
});
test("invalid environment or proxy origins fail instead of silently selecting another backend", () => {
  assert.throws(() => resolveRuntimeConfig({ APP_ENV: "production-typo" }), /APP_ENV/);
  for (const url of ["file:///etc/passwd", "http://user:secret@example.com", "http://example.com/api", "http://example.com/?key=secret"]) assert.throws(() => resolveRuntimeConfig({ BACKEND_URL: url }), /BACKEND_URL/);
  assert.throws(() => resolveRuntimeConfig({ SITE_URL: "javascript:alert(1)" }), /SITE_URL/);
});
