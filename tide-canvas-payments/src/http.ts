import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { Config } from "./config.js";
import type { Provider, CheckoutInput } from "./waffo.js";

export function createAdapter(config: Config, provider: Provider) {
  return createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && req.url === "/healthz") return send(200, { ready: config.ready, mode: config.mode });
    const actual = Buffer.from(req.headers.authorization || "");
    const expected = Buffer.from(`Bearer ${config.token}`);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return send(401, { error: "unauthorized" });
    if (req.method !== "POST") return send(405, { error: "method_not_allowed" });
    if (!config.ready) return send(503, { error: "not_configured" });
    try {
      const chunks: Buffer[] = []; let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 1024 * 1024) return send(413, { error: "body_too_large" });
        chunks.push(Buffer.from(chunk));
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      if (req.url === "/verify-webhook") {
        try { return send(200, provider.verify(raw, typeof req.headers["x-waffo-signature"] === "string" ? req.headers["x-waffo-signature"] : undefined)); }
        catch { return send(400, { error: "invalid_webhook" }); }
      }
      const body = JSON.parse(raw);
      if (body.mode !== config.mode) return send(400, { error: "environment_mismatch" });
      if (req.url === "/checkout") return send(200, await provider.checkout(body as CheckoutInput));
      if (req.url === "/orders") return send(200, { orders: await provider.orders(body.reference) });
      return send(404, { error: "not_found" });
    } catch {
      // SDK errors may contain customer information or credentials. Never send
      // them to clients or write them to the container log.
      return send(502, { error: "provider_unavailable" });
    }
  });
}
