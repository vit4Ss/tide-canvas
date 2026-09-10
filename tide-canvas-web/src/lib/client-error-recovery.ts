const STALE_ASSET_ERROR_PATTERNS = [
  /chunkloaderror/i,
  /failed to load chunk/i,
  /loading (?:css )?chunk [^\n]* failed/i,
  /css_chunk_load_failed/i,
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
];

const RELOAD_MARKER_KEY = "flowinglight:stale-client-asset-reload";
const RELOAD_WINDOW_MS = 5 * 60 * 1000;
const MAX_AUTO_RELOADS = 2;

interface RecoveryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface ReloadMarker {
  count: number;
  savedAt: number;
}

function errorText(value: unknown, depth = 0, seen = new Set<object>()): string {
  if (depth > 3 || value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "";
  seen.add(value);

  try {
    const record = value as Record<string, unknown>;
    // Stack frames/URLs may happen to contain these words; only the actual
    // exception and its cause classify a resource-load failure.
    const own = ["name", "message", "code"]
      .map((key) => record[key])
      .filter((part): part is string => typeof part === "string" && part.length > 0);
    const cause = errorText(record.cause, depth + 1, seen);
    if (cause) own.push(cause);
    return own.join("\n");
  } catch {
    return "";
  }
}

/** Next/Turbopack and browser-native signatures emitted when an old page tries
 * to load a build asset that disappeared during a deployment. */
export function isStaleClientAssetError(error: unknown): boolean {
  const text = errorText(error);
  return STALE_ASSET_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

/** Claim one bounded hard reload for a stale-asset failure. Session storage is
 * deliberately required: if the loop fuse cannot be persisted, fail closed. */
export function claimStaleAssetReload(
  error: unknown,
  _pathname: string,
  storage: RecoveryStorage,
  now = Date.now(),
): boolean {
  if (!isStaleClientAssetError(error)) return false;
  try {
    const parsed = JSON.parse(storage.getItem(RELOAD_MARKER_KEY) || "null") as ReloadMarker | null;
    if (!Number.isFinite(now)) return false;
    if (parsed !== null && (!Number.isFinite(parsed.savedAt) || parsed.savedAt > now
      || !Number.isInteger(parsed.count) || parsed.count < 0)) return false;
    // One fuse for all assets/routes: a different missing chunk must not reset
    // the budget on every reload. Future timestamps fail closed after clock skew.
    const recent = parsed !== null && now - parsed.savedAt < RELOAD_WINDOW_MS;
    const count = recent ? parsed.count : 0;
    if (count >= MAX_AUTO_RELOADS) return false;
    const serialized = JSON.stringify({
      count: count + 1,
      savedAt: recent ? parsed.savedAt : now,
    } satisfies ReloadMarker);
    storage.setItem(RELOAD_MARKER_KEY, serialized);
    if (storage.getItem(RELOAD_MARKER_KEY) !== serialized) return false;
    return true;
  } catch {
    return false;
  }
}

/** Non-sensitive identifier suitable for the public fallback UI. */
export function clientErrorReference(error: unknown): string {
  if (isStaleClientAssetError(error)) return "STALE_CLIENT_ASSET";
  if (error && typeof error === "object") {
    try {
      const record = error as Record<string, unknown>;
      if (typeof record.digest === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(record.digest)) return record.digest;
      if (["TypeError", "ReferenceError", "RangeError", "SyntaxError"].includes(String(record.name))) return String(record.name);
    } catch { /* Keep the generic public reference for hostile error objects. */ }
  }
  return "CLIENT_RENDER_ERROR";
}

/** Claim at execution time so StrictMode cleanup cannot consume a reload. */
export function scheduleAssetRecovery(error: unknown, env: {
  schedule: (run: () => void) => () => void;
  claim: () => boolean;
  canReload: () => boolean;
  reload: () => void;
}): () => void {
  if (!isStaleClientAssetError(error)) return () => {};
  try {
    return env.schedule(() => {
      try {
        if (env.canReload() && env.claim()) env.reload();
      } catch { /* A failed guard/storage access leaves manual recovery available. */ }
    });
  } catch {
    return () => {};
  }
}

/** A root error unmounts route-local save guards. Only an untouched initial
 * document can be safely reloaded automatically; interactive sessions use the
 * explicit reload button so in-flight saves aren't interrupted unexpectedly. */
export function canAutoRecoverDocument(target: { __flowinglightInteracted?: boolean }): boolean {
  return target.__flowinglightInteracted !== true;
}
