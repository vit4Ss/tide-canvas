import { englishError } from "./english.ts";
import type { Result } from "@/types/api";

// Google credentials are single-use exchanges, independent of the website's
// current JWT. Never refresh/retry them automatically or leave a request open.
export async function googleAuthRequest<T>(path: string, body: unknown, signal?: AbortSignal): Promise<Result<T>> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  const failure = (code: number, message: string): Result<T> => ({ success: false, code, message, data: null as T, timestamp: Date.now() });
  try {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal, credentials: "same-origin", cache: "no-store" });
    const result = await response.json().catch(() => null);
    if (!result || typeof result.success !== "boolean" || typeof result.code !== "number") return failure(response.status >= 400 ? response.status : 502, "Google sign-in could not connect to this server. Please try again later.");
    return { ...result, message: result.success ? "" : englishError(result.message) };
  } catch {
    return failure(0, controller.signal.aborted ? "Google sign-in was interrupted or timed out. Please start again." : "Unable to connect to Google sign-in. Check your connection and try again.");
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
  }
}
