"use client";
import { isMediaModel, isTextTask } from "@/lib/model-visibility";
import { Select } from "./select";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Play, KeyRound, Eye, EyeOff, Loader2, RotateCcw, Check, Code2 } from "lucide-react";
import { WorkspaceShell } from "./shell";
import { useAuth } from "./auth-provider";
import { Alert, CopyButton, PageHeading } from "./ui";
import { useResource } from "@/lib/use-resource";
import { userApiKeyApi, type UserApiKey } from "@/lib/user-api-key";
import { ENDPOINTS, curlExample, parseRequestBody, requestPath, requestTemplate, type EndpointKey } from "@/lib/developer";
import { englishError } from "@/lib/english";
import { useBrand } from "./runtime-config";

interface ApiModel { modelId?: string; id: string; name?: string; type?: string; endpoint?: string }
export default function Playground() {
  const { BRAND } = useBrand();
  const query = useSearchParams(); const { user } = useAuth(); const [endpoint, setEndpoint] = useState<EndpointKey>(Object.hasOwn(ENDPOINTS, query.get("endpoint") || "") ? query.get("endpoint") as EndpointKey : "models");
  const [credential, setCredential] = useState({ owner: "", key: "" }); const [showKey, setShowKey] = useState(false); const [models, setModels] = useState<ApiModel[]>([]); const [modelId, setModelId] = useState(""); const [body, setBody] = useState(""); const [taskId, setTaskId] = useState("");
  const [busy, setBusy] = useState(false); const [keyBusy, setKeyBusy] = useState(false); const [error, setError] = useState(""); const [output, setOutput] = useState(""); const [status, setStatus] = useState<number | null>(null); const [elapsed, setElapsed] = useState<number | null>(null); const [origin, setOrigin] = useState(""); const [autoFollow, setAutoFollow] = useState(true);
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => controllerRef.current?.abort(), [user?.id]);
  const meta = useResource<UserApiKey>(`/api/auth/api-key?accountId=${user?.id || ""}`, !!user, user?.id);
  const apiKey = credential.owner && credential.owner !== user?.id ? "" : credential.key;
  const endpointInfo = ENDPOINTS[endpoint]; const candidates = models.filter(isMediaModel); const activeModel = candidates.find((item) => (item.modelId || item.id) === modelId) || candidates[0]; const activeId = activeModel?.modelId || activeModel?.id || modelId || "YOUR_MODEL_ID";
  const bodyText = body || JSON.stringify(requestTemplate(endpoint, activeId, activeModel?.type), null, 2);
  const getKey = async () => { if (!user || !meta.data) return; setKeyBusy(true); setError(""); const response = await userApiKeyApi.reveal(user.id, meta.data.revision); if (response.success) setCredential({ owner: user.id, key: response.data.key }); else setError(response.message); setKeyBusy(false); };
  const loadModels = async () => {
    if (!apiKey) { setError("Add an API key first."); return; }
    setKeyBusy(true); setError("");
    try { const response = await fetch(ENDPOINTS.models.path, { headers: { Authorization: `Bearer ${apiKey}` }, cache: "no-store", signal: AbortSignal.timeout(15000) }); const data = await response.json(); if (!response.ok || data.success === false) throw new Error(englishError(data.message || data.error?.message)); const list = Array.isArray(data.data) ? (data.data as ApiModel[]).filter(isMediaModel) : []; setModels(list); if (!list.length) setError("No models are currently available to this key."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load models."); }
    setKeyBusy(false);
  };
  const run = async () => {
    if (!apiKey.trim()) { setError("Add your API key to run a request."); return; }
    setError(""); setStatus(null); setElapsed(null); setOutput("");
    let parsed: Record<string, unknown> | undefined; let path: string;
    try { path = requestPath(endpoint, taskId); if (endpointInfo.method === "POST") { parsed = parseRequestBody(bodyText); if (endpoint === "generate") { if (isTextTask(parsed)) throw new Error("Choose an image, video, audio, 3D or enhancement workflow."); if (!parsed.clientRequestId) parsed.clientRequestId = crypto.randomUUID(); if (!parsed.modelId || parsed.modelId === "YOUR_MODEL_ID") throw new Error("Load your models or enter a valid modelId before generating."); setBody(JSON.stringify(parsed, null, 2)); } } }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Check your request body."); return; }
    setBusy(true); setOrigin(window.location.origin); const started = performance.now(); const controller = new AbortController(); controllerRef.current = controller; const timeout = setTimeout(() => controller.abort(), 120000);
    try {
      const response = await fetch(path, { method: endpointInfo.method, headers: { Authorization: `Bearer ${apiKey}`, ...(parsed ? { "Content-Type": "application/json" } : {}) }, ...(parsed ? { body: JSON.stringify(parsed) } : {}), signal: controller.signal, cache: "no-store" });
      setStatus(response.status); let raw = await response.text(); let data: Record<string, unknown> | null = null;
      try { data = JSON.parse(raw); raw = JSON.stringify(data, null, 2); } catch { /* Streaming/text responses remain visible as text. */ }
      if (endpoint === "models" && Array.isArray(data?.data)) {
        data = { ...data, data: (data.data as ApiModel[]).filter(isMediaModel) };
        raw = JSON.stringify(data, null, 2);
      }
      if (endpoint === "task" && data?.data && typeof data.data === "object" && isTextTask(data.data)) {
        setError("This task is not available in this media workspace.");
        setElapsed(Math.round(performance.now() - started));
        return;
      }
      setOutput(raw); setElapsed(Math.round(performance.now() - started));
      if (!response.ok || data?.success === false) setError(englishError(data?.message || (data?.error as { message?: string })?.message, `Request returned HTTP ${response.status}.`));
      if (endpoint === "models" && Array.isArray(data?.data)) setModels(data.data as ApiModel[]);
      const task = data?.data as { id?: string; status?: number } | undefined;
      if (endpoint === "generate" && response.ok && data?.success !== false && task?.id) {
        setTaskId(task.id);
        if (autoFollow && task.status === 0) {
          for (;;) {
            await new Promise<void>((resolve) => setTimeout(resolve, 2500)); if (controller.signal.aborted) break;
            const result = await fetch(`/api/open/v1/tasks/${encodeURIComponent(task.id)}`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: controller.signal, cache: "no-store" }); const current = await result.json();
            setOutput(JSON.stringify(current, null, 2)); setElapsed(Math.round(performance.now() - started));
            if (!result.ok || current.success === false || current.data?.status !== 0) break;
          }
        }
      }
    } catch { setError(endpoint === "generate" ? "The connection ended before the outcome was confirmed. Reuse the same clientRequestId and unchanged body to retrieve the original task; do not create a new ID yet." : "The request was interrupted. Check your connection or try again."); }
    finally { clearTimeout(timeout); controllerRef.current = null; setBusy(false); }
  };
  const resetId = () => { try { const parsed = parseRequestBody(bodyText); parsed.clientRequestId = crypto.randomUUID(); setBody(JSON.stringify(parsed, null, 2)); setOutput(""); } catch { setError("Correct the JSON body before creating a new request ID."); } };
  let curlPath = endpointInfo.path; if (endpoint === "task" && taskId) curlPath = `/api/open/v1/tasks/${encodeURIComponent(taskId)}`;
  return <WorkspaceShell><PageHeading title="A space for your next integration." description="Explore real endpoints, try a request and inspect the result." action={<Link className="button small" href="/docs">API documentation <ArrowUpRight size={14} /></Link>} /><div className="playground-layout"><div className="playground-request"><section className="panel key-panel"><div className="panel-label"><h2><KeyRound size={16} />Your API key</h2>{user && <button className="text-link small" onClick={() => void getKey()} disabled={busy || keyBusy || !meta.data}>Use account key</button>}</div><div className="password-input"><input aria-label="API key for request" disabled={busy} type={showKey ? "text" : "password"} autoComplete="off" placeholder="Paste your API key" value={apiKey} onChange={(event) => setCredential({ owner: "", key: event.target.value })} /><button className="icon-button" aria-label={showKey ? "Hide key" : "Show key"} onClick={() => setShowKey(!showKey)}>{showKey ? <EyeOff size={16} /> : <Eye size={16} />}</button></div><div className="key-panel-bottom"><span>Kept in memory for this page only.</span><button className="button small" disabled={busy || keyBusy || !apiKey} onClick={() => void loadModels()}>{keyBusy ? <Loader2 className="spin" size={13} /> : <Check size={13} />}Load models</button></div>{!user && <p className="small muted">Have an account? <Link className="text-link" href="/login?redirect=/playground">Sign in to access your key.</Link></p>}</section><section className="panel request-panel"><div className="field"><label htmlFor="api-endpoint">Endpoint</label><Select id="api-endpoint" disabled={busy} value={endpoint} onValueChange={(value) => { setEndpoint(value as EndpointKey); setBody(""); setError(""); }} options={Object.entries(ENDPOINTS).map(([value, endpoint]) => ({ value, label: endpoint.label }))} /></div><div className="endpoint-display"><span>{endpointInfo.method}</span><code>{curlPath}</code></div><p className="panel-description">{endpointInfo.description}</p>{endpoint === "task" && <div className="field"><label htmlFor="api-task-id">Task ID</label><input id="api-task-id" placeholder="Task ID from a generation response" value={taskId} onChange={(event) => setTaskId(event.target.value)} /></div>}{endpointInfo.method === "POST" && <>{candidates.length > 0 && <div className="field"><label htmlFor="api-model">Model</label><Select id="api-model" disabled={busy} value={activeId} onValueChange={(value) => { setModelId(value); setBody(""); }} options={candidates.map((model) => ({ value: model.modelId || model.id, label: model.name && !/[\p{Script=Han}]/u.test(model.name) ? model.name : model.modelId || model.id }))} /></div>}<div className="field"><div className="request-body-label"><label htmlFor="api-body">Request body</label>{endpoint === "generate" && <button disabled={busy} onClick={resetId}><RotateCcw size={11} />New request ID</button>}</div><textarea id="api-body" className="json-editor" spellCheck={false} disabled={busy} value={bodyText} onChange={(event) => setBody(event.target.value)} /></div></>}{endpoint === "generate" && <label className="check-row"><input type="checkbox" checked={autoFollow} onChange={(event) => setAutoFollow(event.target.checked)} />Follow the accepted task to its result</label>}{error && <Alert>{error}</Alert>}<div className="request-actions"><button className="button primary" disabled={busy || !apiKey} onClick={() => void run()}>{busy ? <Loader2 className="spin" size={15} /> : <Play size={14} fill="currentColor" />}{busy ? "Following request…" : "Run request"}</button>{busy && <button className="button" onClick={() => controllerRef.current?.abort()}>Stop following</button>}<span>{endpointInfo.method === "POST" ? "This request uses your account credits." : "Read-only request."}</span></div></section></div><div className="playground-response"><section className="panel response-panel"><div className="response-heading"><h2>Response</h2><div>{status !== null && <span className={`tag ${status < 400 ? "good" : ""}`}>HTTP {status}</span>}{elapsed !== null && <span className="tag">{elapsed} ms</span>}{output && <CopyButton value={output} />}</div></div>{output ? <pre className="response-code">{output}</pre> : <div className="response-empty"><Code2 className="response-empty-icon" size={32} /><h3>The next part is up to you.</h3><p>Choose an endpoint and run a request.<br />The full response will appear here.</p></div>}</section><section className="panel curl-panel"><div className="response-heading"><h2>Try it in your terminal</h2><CopyButton value={curlExample(origin || BRAND.siteUrl, endpointInfo.method, curlPath, bodyText)} /></div><pre>{curlExample(origin || BRAND.siteUrl, endpointInfo.method, curlPath, bodyText)}</pre><p>Set FRAMELYN_API_KEY in your environment. The copied example never includes the key you entered here.</p></section></div></div></WorkspaceShell>;
}
