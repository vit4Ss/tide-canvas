import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// @ts-expect-error Node's native TypeScript loader requires the source suffix.
import { resolveBrowserApiUrl } from "./public-api-url.ts";

test("browser API URLs stay on the website origin by default", () => {
  assert.equal(
    resolveBrowserApiUrl("/api/files/download?ticket=abc", "", "https://flowlight.example"),
    "https://flowlight.example/api/files/download?ticket=abc",
  );
});

test("production pages reject loopback browser API configuration", () => {
  for (const configured of [
    "http://127.0.0.1:8081",
    "http://127.9.8.7:8081",
    "http://localhost:8081",
    "http://[::1]:8081",
    "http://0.0.0.0:8081",
  ]) {
    assert.equal(
      resolveBrowserApiUrl("/api/files/download", configured, "https://flowlight.example"),
      "https://flowlight.example/api/files/download",
      configured,
    );
  }
});

test("local development and explicit public API domains remain supported", () => {
  assert.equal(
    resolveBrowserApiUrl("/api/ping", "http://127.0.0.1:8081", "http://localhost:3000"),
    "http://127.0.0.1:8081/api/ping",
  );
  assert.equal(
    resolveBrowserApiUrl("/api/ping", "https://api.flowlight.example", "https://flowlight.example"),
    "https://api.flowlight.example/api/ping",
  );
  assert.equal(
    resolveBrowserApiUrl("/api/ping", "not a url", "https://flowlight.example"),
    "https://flowlight.example/api/ping",
  );
  assert.equal(
    resolveBrowserApiUrl("/api/ping", "javascript:alert(1)", "https://flowlight.example"),
    "https://flowlight.example/api/ping",
  );
});

test("Docker keeps internal and browser API bases separate", () => {
  const dockerfile = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8");
  assert.match(dockerfile, /ARG NEXT_PUBLIC_API_BASE_URL=http:\/\/127\.0\.0\.1:8081/);
  assert.match(dockerfile, /ARG NEXT_PUBLIC_BROWSER_API_BASE_URL=\r?\n/);
  assert.match(dockerfile, /NEXT_PUBLIC_BROWSER_API_BASE_URL=\$NEXT_PUBLIC_BROWSER_API_BASE_URL/);
});
