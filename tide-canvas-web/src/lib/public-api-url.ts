function isLoopbackHost(rawHostname: string): boolean {
  const hostname = rawHostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  return hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname === "::1"
    || hostname === "0.0.0.0"
    || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

/** Resolve a browser-visible API URL without leaking a container loopback
 * address. A loopback public base is valid only when the page itself is also
 * running locally; production pages fail closed to their own origin. */
export function resolveBrowserApiUrl(path: string, configuredBase: string, currentOrigin: string): string {
  let base = currentOrigin;
  const configured = configuredBase.trim();
  if (configured) {
    try {
      const candidate = new URL(configured);
      const current = new URL(currentOrigin);
      const isHTTP = candidate.protocol === "http:" || candidate.protocol === "https:";
      if (isHTTP && (!isLoopbackHost(candidate.hostname) || isLoopbackHost(current.hostname))) {
        base = candidate.toString();
      }
    } catch {
      // Invalid public configuration must not break downloads; same-origin
      // /api remains the safe deployment default.
    }
  }
  return new URL(path, base).toString();
}
