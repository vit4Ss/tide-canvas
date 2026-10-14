import { readConfig } from "./config.js";
import { createProvider } from "./waffo.js";
import { promptDiagnostic } from "./prompt-diagnostics.js";

// Sends only this fixed diagnostic prompt, never customer content. Creates no
// generation or order. Do not print SDK error messages or configuration values.
const started = Date.now();
try {
  const config = readConfig();
  if (!config.ready) {
    console.log(JSON.stringify({ ok: false, reasonCode: "adapter_not_configured" }));
    process.exitCode = 1;
  } else {
    const result = await createProvider(config).scanPrompt("A peaceful mountain landscape at sunrise.");
    console.log(JSON.stringify({ ok: result.action === "allow", mode: config.mode, ...result, elapsedMs: Date.now() - started }));
    if (result.action !== "allow") process.exitCode = 1;
  }
} catch (error) {
  console.log(JSON.stringify({ ok: false, ...promptDiagnostic(error), elapsedMs: Date.now() - started }));
  process.exitCode = 1;
}
