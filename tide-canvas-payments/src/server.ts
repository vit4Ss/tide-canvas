import { readConfig } from "./config.js";
import { createProvider } from "./waffo.js";
import { createAdapter } from "./http.js";
const config = readConfig();
const server = createAdapter(config, createProvider(config));
server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.listen(config.port, config.host, () => console.log(`Payments adapter listening on ${config.host}:${config.port} (${config.mode}, ready=${config.ready})`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
