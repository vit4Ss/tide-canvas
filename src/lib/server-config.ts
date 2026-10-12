import "server-only";
import { resolveRuntimeConfig } from "./runtime-config";

// Read in dynamic server code at request time, never in next.config/build args.
export function getServerConfig() { return resolveRuntimeConfig(process.env); }
