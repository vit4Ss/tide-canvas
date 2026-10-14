import { WaffoPancakeError } from "@waffo/pancake-ts";

export class InvalidPromptVerdict extends Error {}

// Only fixed diagnostic codes cross the adapter boundary. SDK messages and
// response bodies may contain credentials or user text and must never be logged.
export function promptDiagnostic(error: unknown): { reasonCode: string; upstreamStatus?: number } {
  if (error instanceof InvalidPromptVerdict) return { reasonCode: "upstream_invalid_response" };
  if (error instanceof WaffoPancakeError) {
    const status = error.status;
    if (!Number.isInteger(status) || status < 100 || status > 599) return { reasonCode: "upstream_unavailable" };
    const reasonCode = status === 401 ? "upstream_unauthorized" : status === 403 ? "upstream_forbidden" :
      status === 429 ? "upstream_rate_limited" : status === 408 || status === 504 ? "upstream_timeout" :
      status >= 400 && status < 500 ? "upstream_request_rejected" : status >= 500 ? "upstream_unavailable" : "upstream_invalid_response";
    return { reasonCode, upstreamStatus: status };
  }
  if (error instanceof Error) {
    const cause = error.cause as { code?: unknown } | undefined;
    if (["TimeoutError", "AbortError"].includes(error.name) || ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"].includes(String(cause?.code))) return { reasonCode: "upstream_timeout" };
    if (["ENOTFOUND", "EAI_AGAIN"].includes(String(cause?.code))) return { reasonCode: "upstream_dns_error" };
    if (["CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "DEPTH_ZERO_SELF_SIGNED_CERT", "ERR_TLS_CERT_ALTNAME_INVALID"].includes(String(cause?.code))) return { reasonCode: "upstream_tls_error" };
    if (["ECONNRESET", "ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_SOCKET"].includes(String(cause?.code))) return { reasonCode: "upstream_network_error" };
  }
  return { reasonCode: "upstream_unavailable" };
}
