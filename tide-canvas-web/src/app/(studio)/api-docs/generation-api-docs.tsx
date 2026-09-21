"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, Code2, Copy, KeyRound, ArrowUpRight } from "lucide-react";
import { aiApi } from "@/lib/api";
import { mcpConfigApi, mcpClientConfig, type MCPConfig } from "@/lib/mcp-config-api";
import type { AiHandlerVO, AiModelVO } from "@/types/ai";
import styles from "./page.module.css";

const noopSubscribe = () => () => {};
const originSnapshot = () => window.location.origin;
const serverOrigin = () => "https://你的主站域名";
const sections = [["start", "接入概览"], ["models", "模型与参数"], ["generate", "提交生成"], ["tasks", "进度与结果"], ["files", "上传与下载"], ["mcp", "MCP 接入"], ["chat", "对话接口与智能体接入"], ["billing", "计费与重试"], ["errors", "错误处理"]];
const examples: Record<string, { label: string; type: string; input: Record<string, unknown> }> = {
  text_to_image: { label: "文生图", type: "image", input: { prompt: "一座漂浮在云海中的未来城市", ratio: "1:1", batchCount: 1 } },
  image_to_image: { label: "图生图", type: "image", input: { prompt: "保留构图，将天空改为日落", imageUrls: ["上传返回的 fileUrl"], batchCount: 1 } },
  text_to_video: { label: "文生视频", type: "video", input: { prompt: "镜头缓缓穿过云海，展现未来城市" } },
  image_to_video: { label: "图生视频", type: "video", input: { prompt: "镜头缓缓推进", imageUrls: ["上传返回的 fileUrl"] } },
  start_end_to_video: { label: "首尾帧视频", type: "video", input: { prompt: "平滑过渡", firstFrame: "首帧 fileUrl", lastFrame: "尾帧 fileUrl" } },
  reference_to_video: { label: "参考生视频", type: "video", input: { prompt: "保持主体一致，让人物挥手", imageUrls: ["参考图 fileUrl"] } },
  text_to_audio: { label: "音频生成", type: "audio", input: { prompt: "舒缓的钢琴背景音乐" } },
  generate_3d: { label: "3D 生成", type: "3d", input: { prompt: "一把科幻座椅" } },
};

function Code({ children, label = "cURL" }: { children: string; label?: string }) {
  const [copyState, setCopyState] = useState("");
  return <div className={styles.code}>
    <div><span>{label}</span><button type="button" onClick={async () => {
      try { await navigator.clipboard.writeText(children); setCopyState("已复制"); }
      catch { setCopyState("请选中代码手动复制"); }
    }}>{copyState === "已复制" ? <Check size={14} /> : <Copy size={14} />}<span role="status">{copyState || "复制"}</span></button></div>
    <pre><code>{children}</code></pre>
  </div>;
}

function Endpoint({ method, path }: { method: "GET" | "POST"; path: string }) {
  return <div className={styles.endpoint}><b>{method}</b><code>{path}</code></div>;
}

export default function GenerationAPIDocs() {
  const origin = useSyncExternalStore(noopSubscribe, originSnapshot, serverOrigin);
  const base = `${origin}/api/open/v1`;
  const chatBase = `${origin}/api/integrations/v1`;
  const [models, setModels] = useState<AiModelVO[]>([]);
  const [handlers, setHandlers] = useState<AiHandlerVO[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [mcpPolicy, setMCPPolicy] = useState<MCPConfig | null>(null);
  const [handler, setHandler] = useState("text_to_image");
  const [modelID, setModelID] = useState("");
  useEffect(() => {
    let alive = true;
    void Promise.all([aiApi.listModels(), aiApi.listHandlers()]).then(([m, h]) => {
      if (!alive) return;
      if (!m.success || !h.success) { setLoadError(true); return; }
      setModels(m.data ?? []); setHandlers(h.data ?? []); setLoadError(false);
    }).catch(() => { if (alive) setLoadError(true); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [revision]);
  useEffect(() => {
    let alive = true;
    void mcpConfigApi.publicConfig().then((res) => { if (alive) setMCPPolicy(res.success ? res.data : null); }).catch(() => { if (alive) setMCPPolicy(null); });
    return () => { alive = false; };
  }, [revision]);
  const example = examples[handler];
  const choices = models.filter((m) => m.type === example.type && (!m.supportedHandlers?.length || m.supportedHandlers.includes(handler)));
  const selected = choices.find((m) => m.modelId === modelID) ?? choices[0];
  const selectedHandler = handlers.find((h) => h.handlerName === handler);
  const payload = { handler, modelId: selected?.modelId ?? "从模型列表选择 modelId", clientRequestId: "example-job-001", input: example.input };
  const auth = '-H "Authorization: Bearer $FLOWLIGHT_API_KEY"';
  // POSIX shell quoting keeps model identifiers/prompt text literal in examples.
  const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const create = `curl ${shellQuote(`${base}/generations`)} \\\n  ${auth} \\\n  -H "Content-Type: application/json" \\\n  --data ${shellQuote(JSON.stringify(payload, null, 2))}`;
  const codexConfig = `model = "flowinglight/模型名"          # 从 GET /models 返回的 id 里选\nmodel_provider = "flowinglight"\n\n[model_providers.flowinglight]\nname = "流光"\nbase_url = "${chatBase}"\nenv_key = "FLOWLIGHT_API_KEY"\nwire_api = "responses"`;
  const chatExample = `curl ${shellQuote(`${chatBase}/chat/completions`)} \\\n  ${auth} \\\n  -H "Content-Type: application/json" \\\n  --data ${shellQuote(JSON.stringify({ model: "flowinglight/模型名", messages: [{ role: "user", content: "你好" }], stream: true }, null, 2))}`;

  return <main className={styles.page}>
    <header className={styles.top}><span><Code2 size={18} />开发者文档 <b>GENERATION / V1</b></span><Link href="/api-usage">API 调用记录<ArrowUpRight size={14} /></Link><Link href="/account"><KeyRound size={15} />管理 API Key<ArrowUpRight size={14} /></Link></header>
    <div className={styles.layout}>
      <nav className={styles.toc} aria-label="文档目录"><span>生成 API</span>{sections.map(([id, title], i) => <a key={id} href={`#${id}`}><small>{String(i + 1).padStart(2, "0")}</small>{title}</a>)}<Link href="/studio">查看创作台记录 ↗</Link></nav>
      <article className={styles.article}>
        <section id="start" className={styles.intro}>
          <div className={styles.eyebrow}>FLOWINGLIGHT / 开放接口</div><h1>把创作能力，接进你的应用。</h1>
          <p>一把 API Key，两个入口。先确定要做的事，再填对应的地址：两个入口的路径不同，填错会直接得到 404。</p>
          <div className={styles.routes}>
            <div className={styles.route}>
              <span>接入智能体 · 对话</span>
              <h3>Codex、Cursor、Cherry Studio 等 OpenAI 兼容客户端</h3>
              <dl>
                <dt>Base URL</dt><dd><code>{chatBase}</code></dd>
                <dt>API Key</dt><dd>个人中心的默认 API Key</dd>
                <dt>模型</dt><dd><code>flowinglight/模型名</code>，从该入口的 <code>GET /models</code> 里选</dd>
                <dt>协议 · 计费</dt><dd>OpenAI Responses 或 Chat Completions · 按 Token</dd>
              </dl>
              <a href="#chat">查看 Codex 配置与请求示例<ArrowUpRight size={13} /></a>
            </div>
            <div className={styles.route}>
              <span>调用生成 API · 图片 / 视频 / 音频 / 3D</span>
              <h3>自己的服务端代码直接提交生成任务</h3>
              <dl>
                <dt>Base URL</dt><dd><code>{base}</code></dd>
                <dt>API Key</dt><dd>同一把默认 API Key</dd>
                <dt>流程</dt><dd><code>POST /generations</code> 返回任务 ID，再轮询 <code>GET /tasks/:id</code></dd>
                <dt>计费</dt><dd>按次，沿用主站模型价格；失败自动退款</dd>
              </dl>
              <a href="#generate">查看提交与轮询示例<ArrowUpRight size={13} /></a>
            </div>
          </div>
          <p className={styles.note}>最常见的错误是把生成 API 的地址填进聊天客户端：请求会落到 <code>/api/open/v1/chat/completions</code>，返回 404 <code>route not found</code>。聊天客户端只认对话入口；生成接口也不受理文本模型，收到 <code>assistant_chat</code> 等文本能力会返回业务码 2003 并指回对话入口。两个入口的模型列表与价格是两套；文档不发起付费测试。</p>
          <Code label="鉴权 · Bash / macOS / Linux">{'export FLOWLIGHT_API_KEY="你的账号 API Key"\n# 每次请求携带 Authorization: Bearer $FLOWLIGHT_API_KEY'}</Code>
          <p>密钥只放在自己的服务端。停用或重置后，旧 Key 将无法提交或查询任务。只允许访问当前账号的数据；API Key 不具备管理员权限。</p>
        </section>
        <section id="models"><h2>模型与参数</h2><Endpoint method="GET" path="/models" /><p>返回当前可用的模型。图片、视频、音频、3D 模型用于本节的生成任务；<code>type</code> 为 <code>text</code> 的模型来自对话接口的供应商，带 <code>endpoint</code> 与 <code>billing: token</code>，只能通过下方的对话接口调用，不能提交生成任务。创建任务使用 <code>data[].modelId</code>；<code>supportedHandlers</code> 表示支持的生成能力，<code>config</code> 是包含规格与定价等配置的 JSON 字符串。</p>
          <Code>{`curl ${shellQuote(`${base}/models`)} ${auth}`}</Code>
          <div className={styles.picker}><label>生成能力<select value={handler} onChange={(e) => { setHandler(e.target.value); setModelID(""); }}>{Object.entries(examples).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}</select></label><label>当前模型<select value={selected?.modelId ?? ""} onChange={(e) => setModelID(e.target.value)} disabled={!choices.length}><option value="" disabled>{loading ? "载入模型…" : "暂无可用模型"}</option>{choices.map((m) => <option key={m.id} value={m.modelId}>{m.name}</option>)}</select></label></div>
          {loadError && <p role="alert">模型列表加载失败。<button type="button" onClick={() => { setLoading(true); setRevision((r) => r + 1); }}>重试</button></p>}
          {!loading && !loadError && !choices.length && <p className={styles.note}>后台目前没有该能力的可用模型。示例中的模型占位值需要替换后才能使用。</p>}
          {selected && <details><summary>查看 {selected.name} 的完整配置与定价</summary><Code label="模型配置">{JSON.stringify(selected, null, 2)}</Code></details>}
          <Endpoint method="GET" path="/handlers" /><p>读取各能力的 <code>handlerName</code> 与 <code>inputSchema</code>。以所选模型支持的参数为准，示例只展示基本输入；视频时长、分辨率、参考素材限制需根据模型配置补充。</p>
          {selectedHandler && <details><summary>查看当前能力的输入 Schema</summary><Code label="inputSchema">{JSON.stringify(selectedHandler.inputSchema, null, 2)}</Code></details>}
          <Endpoint method="GET" path="/tools" /><p>读取已开放工具的 handler、key、extraParams。调用工具时，将 key 放入 <code>input.toolKey</code>，并按工具要求提供参考素材。局部重绘还需原图和蒙版，普通参考图不能替代蒙版。</p>
        </section>
        <section id="generate"><h2>提交生成</h2><div className={styles.address}><span>BASE URL · 生成 API</span><code>{base}</code></div><Endpoint method="POST" path="/generations" /><p>异步接口：提交成功只表示任务已受理。最终状态通过任务查询获取。</p><Code key={handler + selected?.modelId}>{create}</Code>
          <div className={styles.table}><table><thead><tr><th>字段</th><th>要求</th><th>含义</th></tr></thead><tbody>
            <tr><td>handler</td><td>必填 · string</td><td>生成能力，例如 text_to_image</td></tr><tr><td>modelId</td><td>必填 · string</td><td>模型列表中的 modelId；避免使用展示名称</td></tr><tr><td>clientRequestId</td><td>必填，或使用请求头</td><td>1–80 位字母、数字、点、下划线、冒号或连字符，首位字母或数字。新任务换新编号，重试保持不变</td></tr><tr><td>input</td><td>必填 · object</td><td>prompt、batchCount、ratio、resolution、quality、duration、imageUrls 等，按能力与模型配置传入</td></tr>
          </tbody></table></div>
          <p>也可用 <code>Idempotency-Key</code> 请求头替代 clientRequestId；同时传入时必须一致。JSON 请求体最大 2 MiB。userId、projectId、积分与来源不允许自行指定，接口任务自动归当前账号。</p>
          <p>图片数量使用 <code>input.batchCount</code>，兼容别名 <code>n</code> 和 <code>batch</code>，取值为 1–4 的整数；后台固定单张的模型只能传 1。其他生成能力不支持多张数量。清晰度统一使用 <code>resolution</code>，兼容 <code>clarity</code>；同一参数的不同别名不能传入冲突值。</p>
          <Code label="响应示例 · 任务已受理">{JSON.stringify({ success: true, code: 200, message: "success", data: { id: "任务ID字符串", handler, isApiCall: true, status: 0, progress: 0, pointCost: 8, resultUrl: "", resultMeta: {}, errorMsg: "" }, timestamp: 1789790400000 }, null, 2)}</Code><p className={styles.note}>以上积分仅为响应格式示例。实际扣费由服务端依据模型、数量、规格和账户规则计算，以任务的 pointCost 为准。</p>
        </section>
        <section id="tasks"><h2>进度与结果</h2><Endpoint method="GET" path="/tasks/:id" /><Code>{`curl ${shellQuote(`${base}/tasks/任务ID`)} ${auth}`}</Code>
          <div className={styles.table}><table><thead><tr><th>status</th><th>状态</th><th>下一步</th></tr></thead><tbody><tr><td>0</td><td>生成中</td><td>每 5–10 秒查询；不要重新创建任务</td></tr><tr><td>1</td><td>成功</td><td>读取 resultUrl、resultMeta.urls；文本位于 resultMeta.text</td></tr><tr><td>2</td><td>失败</td><td>显示 errorMsg，停止轮询；按既有失败退款机制退积分</td></tr><tr><td>3</td><td>已取消</td><td>停止轮询。已派发任务取消不保证退款</td></tr></tbody></table></div>
          <p>任务 ID 必须按字符串处理，不能转为 JavaScript Number。音频分轨和 3D 格式等额外结果位于 resultMeta。查询接口返回的 modelId 是主站模型记录 ID，重新生成时仍从模型列表获取模型标识。</p>
          <Endpoint method="GET" path="/tasks?pageNum=1&pageSize=20" /><p>分页查看当前账号的接口调用记录。支持 status、handler、startDate、endDate 筛选，pageSize 最大 100。创作台与生成记录同时展示这些任务，带“接口调用”标签；历史网页任务默认非接口调用。</p>
          <Code label="Python · 标准库轮询（先用上面的请求提交）">{`import json, os, time\nfrom urllib.request import Request, urlopen\n\nbase = ${JSON.stringify(base)}\ntask_id = "替换为创建响应 data.id"\nheaders = {"Authorization": "Bearer " + os.environ["FLOWLIGHT_API_KEY"]}\ndeadline = time.monotonic() + 3600\nwhile time.monotonic() < deadline:\n    req = Request(f"{base}/tasks/{task_id}", headers=headers)\n    with urlopen(req, timeout=30) as res:\n        body = json.load(res)\n    if not body.get("success"):\n        raise RuntimeError(body.get("message", body))\n    task = body["data"]\n    if task["status"] != 0:\n        if task["status"] != 1:\n            raise RuntimeError(task.get("errorMsg") or "任务未成功")\n        print(task["resultUrl"], task["resultMeta"])\n        break\n    time.sleep(5)\nelse:\n    raise TimeoutError("停止本地等待；保留 task_id，稍后继续查询，不要重复提交")`}</Code>
        </section>
        <section id="files"><h2>上传与下载</h2><Endpoint method="POST" path="/files" /><p>使用 multipart/form-data，文件字段名为 file，单文件上限 100 MiB，同时受账号存储配额和反向代理限制。将返回的 data.fileUrl 放进生成参数，例如 input.imageUrls。</p><Code>{`curl ${shellQuote(`${base}/files`)} \\\n  ${auth} \\\n  -F "file=@reference.png"`}</Code>
          <Endpoint method="GET" path="/files/download?url=…&name=…" /><p>下载当前账号有权限的结果或素材，以二进制附件返回。请只对非错误响应保存文件；文件 URL 需进行 URL 编码。</p><Code>{`curl --fail-with-body --get ${shellQuote(`${base}/files/download`)} \\\n  ${auth} \\\n  --data-urlencode "url=替换为任务返回的 resultUrl" \\\n  --data-urlencode "name=result.png" \\\n  --output result.png`}</Code>
        </section>
        <section id="mcp"><h2>MCP 接入</h2>
          <p>在支持 MCP 的 AI 客户端中，把主站的图片、视频、音频生成接成工具。沿用你的 API Key 和积分，生成记录同步到创作台。</p>
          <Endpoint method="POST" path={mcpPolicy?.publicUrl || `${origin}/mcp`} />
          {mcpPolicy && !mcpPolicy.enabled && <p className={styles.note}>管理员暂时关闭了 MCP 接入。</p>}
          <p className={styles.note}>管理员需先启动独立 MCP 服务并配置反向代理。服务默认监听 127.0.0.1:8082，本机测试直接连接 http://127.0.0.1:8082/mcp。上方是部署后的远程入口，不是普通 REST 接口。</p>
          <Code label="远程 MCP · URL + Bearer Header">{JSON.stringify(mcpClientConfig(mcpPolicy?.publicUrl ?? "",origin), null, 2)}</Code>
          <div className={styles.table}><table><thead><tr><th>工具</th><th>能力</th><th>费用</th></tr></thead><tbody>{[["list_models", "查询真实模型与配置", "免费"], ["generate_image", "文生图、图生图", "按主站模型计费"], ["generate_video", "文生、图生、首尾帧、全能参考", "按主站模型计费"], ["generate_audio", "音乐、音效或语音", "按主站模型计费"], ["get_generation_task", "查询进度与结果", "免费"], ["list_generation_tasks", "查看自己的接口调用历史", "免费"], ["get_balance", "查看积分余额", "免费"]].map(([tool, usage, cost]) => <tr key={tool}><td>{tool}</td><td>{usage}</td><td>{cost}</td></tr>)}</tbody></table></div>
          <p>先查询模型，再生成。生成工具需要 modelId 和唯一 clientRequestId；prompt 描述需求，parameters 携带分辨率、质量、时长等模型参数。参考素材先上传到主站，再把 URL 传给工具。</p>
          <Code label="工具调用示例 · 图片">{JSON.stringify({ name: "generate_image", arguments: { modelId: "从 list_models 选择真实模型", clientRequestId: "image-job-001", prompt: "云海中的未来城市", parameters: { resolution: "4k", quality: "high", batchCount: 1 } } }, null, 2)}</Code>
          <p>工具先返回 task.id 和 statusText。processing 表示生成中，每 5–10 秒通过 get_generation_task 查询；succeeded 后读取结果 URL。重试沿用原编号和参数。不同客户端的配置入口不同，请选择 Streamable HTTP 和手动 Bearer Key；本服务也支持 stdio 模式。</p>
        </section>
        <section id="chat"><h2>对话接口与智能体接入</h2>
          <p>用同一把 API Key 直接调用后台「AI 聊天供应商」里开放的对话模型。接口兼容 OpenAI 协议，按实际 Token 用量从账号积分结算。通过 API 使用文本模型只有这一条路：生成接口的模型列表里 type 为 text 的就是这些模型，价格与上面的生成模型是两套。</p>
          <div className={styles.address}><span>BASE URL · 填进智能体客户端</span><code>{chatBase}</code></div>
          <p>任何 OpenAI 兼容客户端都按同一套填法：Base URL 填上面的地址，API Key 填默认 API Key，模型填 <code>GET /models</code> 返回的 <code>id</code>。支持选择协议的客户端优先选 Responses，否则选 Chat Completions；不要在地址后再拼 <code>/chat/completions</code>，客户端会自己补路径。</p>
          <Endpoint method="GET" path="/models" /><p>返回可调用的对话模型。<code>id</code> 形如 <code>flowinglight/模型名</code>，调用时用它或去掉前缀的模型名都可以；<code>token_pricing</code> 是每百万 Token 的积分单价。</p>
          <Code>{`curl ${shellQuote(`${chatBase}/models`)} ${auth}`}</Code>
          <Endpoint method="POST" path="/responses" /><p>OpenAI Responses 协议，Codex 用的就是它。网关把请求转成供应商的 Chat Completions 调用，再把流式结果转回 Responses 事件。<code>previous_response_id</code> 不受支持：网关不保存对话，请像 Codex 一样把完整历史放进 <code>input</code>。</p>
          <Code label="Codex · ~/.codex/config.toml">{codexConfig}</Code>
          <p>把 API Key 放进环境变量 <code>FLOWLIGHT_API_KEY</code> 后启动 Codex 即可。<code>wire_api</code> 只能是 <code>responses</code>，Codex 已移除 chat 协议；<code>model_providers</code> 必须写在用户级配置里，项目内的 .codex/config.toml 不接受它。</p>
          <Endpoint method="POST" path="/chat/completions" /><p>OpenAI Chat Completions 协议，供 SDK 与其他客户端使用。请求原样转给供应商，只替换模型名、补上输出上限和用量统计；供应商的拒绝原文会直接返回。</p>
          <Code>{chatExample}</Code>
          <p>响应头 <code>X-Point-Reserved</code> 是本次预留的积分上限；非流式响应的 <code>X-Point-Cost</code> 头和 <code>billing</code> 字段、流式响应末尾的 <code>billing</code> 对象是按用量结算的实际积分，未用完的预留在结算时释放。每账号同时进行中的调用数受限；积分不足时返回 429 <code>insufficient_quota</code>，不会调用供应商。账单在个人中心与后台「Token 调用账单」中核对。</p>
        </section>
        <section id="billing"><h2>积分、幂等与记录</h2><p>生成接口和网页共享账号积分、并发限制、后台模型维护状态与计费规则。受理时扣积分，余额不足会在调用模型前拒绝；模型执行失败会进入原有退款流程，可在积分流水核对。</p><p>同一账号、同一请求编号、相同参数只生成一次。相同编号改参数会被拒绝；已经失败的任务也会返回原记录，确需再次生成请使用新编号。HTTP 超时不等于任务失败，先用原编号和原参数重试以找回任务。</p>
          <Endpoint method="POST" path="/upscale-quote" /><p>视频超分预估：<code>{'{"modelId":"…","videoUrl":"…","targetResolution":"4k"}'}</code>。</p><Endpoint method="POST" path="/reference-video-quote" /><p>参考视频附加费用预估：<code>{'{"modelId":"…","resolution":"1080p","videoUrls":["…"]}'}</code>。预估不扣费，正式生成会重新验证归属、时长和价格。</p>
        </section>
        <section id="errors"><h2>错误处理</h2><p>业务响应统一检查 <code>success</code> 与 <code>code</code>，不要只检查 HTTP 200。鉴权失败使用 <code>error.message</code>；其他错误提示读取 message 或最终任务 errorMsg。</p><div className={styles.table}><table><thead><tr><th>代码</th><th>说明</th><th>处理方式</th></tr></thead><tbody>{[["400", "参数错误 / 请求编号冲突", "根据 message 修正参数；不要盲目重试"], ["401 / 403", "密钥或访问权限错误", "检查 Bearer Key、账号状态和资源归属"], ["404", "任务或素材不存在", "确认 ID 属于当前账号且未删除"], ["2001", "积分不足", "补充积分后再提交"], ["2002 / 2003 / 2005", "模型、能力或工具不可用", "刷新模型列表，检查维护状态"], ["2006", "并发任务达到上限", "等待已有任务结束"], ["3001 / 3002 / 3003", "类型、大小或存储空间限制", "检查文件与账号存储额度"], ["429", "请求频率超限", "按 Retry-After 等待，或退避重试"], ["500 / 503", "服务暂不可用", "保留请求编号，稍后重试"]].map(([code, desc, action]) => <tr key={code}><td>{code}</td><td>{desc}</td><td>{action}</td></tr>)}</tbody></table></div>
          <p>提交生成与上传各限每 IP 每分钟 30 次；模型和任务查询每路由每 IP 每分钟 120 次；预估及下载每路由每 IP 每分钟 60 次。限流依赖服务端 Redis，账户生成并发与积分限制始终生效。</p>
        </section>
      </article>
    </div>
  </main>;
}
