import http from "node:http";
import https from "node:https";

const targetBase = new URL(process.env.API_TARGET || "http://127.0.0.1:8080");
const port = Number(process.env.PORT || 3111);
const client = targetBase.protocol === "https:" ? https : http;

const hopByHop = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "origin",
  "referer",
]);

function applyCors(res, origin) {
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.setHeader("Access-Control-Max-Age", "600");
}

function cleanHeaders(headers) {
  const next = { ...headers };
  for (const key of Object.keys(next)) {
    if (hopByHop.has(key.toLowerCase())) delete next[key];
  }
  return next;
}

const server = http.createServer((req, res) => {
  const origin = req.headers.origin;
  applyCors(res, origin);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const target = new URL(req.url || "/", targetBase);
  const upstream = client.request(
    target,
    {
      method: req.method,
      headers: cleanHeaders(req.headers),
    },
    (upstreamRes) => {
      const headers = cleanHeaders(upstreamRes.headers);
      headers["access-control-allow-origin"] = origin || "*";
      headers["access-control-allow-methods"] = "GET,POST,PUT,PATCH,DELETE,OPTIONS";
      headers["access-control-allow-headers"] = "Content-Type,Authorization";
      headers["access-control-max-age"] = "600";
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.statusMessage, headers);
      upstreamRes.pipe(res);
    },
  );

  upstream.on("error", (error) => {
    res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ success: false, code: 502, message: "Dev API proxy failed", detail: error.message }));
  });

  req.pipe(upstream);
});

server.listen(port, "127.0.0.1", () => {
  console.log("Dev API proxy listening on http://127.0.0.1:" + port + " -> " + targetBase.origin);
});
