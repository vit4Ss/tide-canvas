"use client";

// 富文本提示词输入框的共享工具：「图片N / 视频N / 音频N」内联引用 token 的
// 创建/序列化、光标处理、缩略图。由画布的图片节点、视频节点与 AI 助手面板的
// <PromptRefEditor> 共用（逻辑搬自 image-node，行为保持一致）。
//
// token 词汇表与创作台 MentionPromptEditor 一致；两边各自实现是因为画布路由组
// 不加载 studio.css（(canvas)/layout.tsx 一行 CSS 都不 import，还主动摘掉 imini
// 类），.mention-* 依赖的主题变量在画布里不存在，只能走 Tailwind 内联。

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  CanvasReferenceItem,
  CanvasReferenceKind,
} from "@/features/canvas/domain/models/canvas-reference";

export type {
  CanvasReferenceItem as RefItem,
  CanvasReferenceKind as RefKind,
} from "@/features/canvas/domain/models/canvas-reference";

export const LINE_HEIGHT = 24;
export const MIN_ROWS = 3;
export const MAX_ROWS = 4;

/** pill 后的哨兵字符(U+200B)：光标落点 + @ 触发边界。插入路径与重建路径共用
 *  同一常量，避免两边各写各的再次漂移。用 fromCharCode 避免源码出现不可见字符。 */
export const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
const NON_BREAKING_SPACE = String.fromCharCode(0x00a0);

type RefKind = CanvasReferenceKind;
type RefItem = CanvasReferenceItem;

const KIND_LABEL: Record<RefKind, string> = { image: "图片", video: "视频", audio: "音频", text: "文本" };

/** 无缩略图时的降级字形：视频节点只有 videoSrc（放进 <img> 是坏图），音频与文本没有画面。 */
const KIND_GLYPH: Record<RefKind, string> = { image: "图", video: "▶", audio: "♪", text: "文" };

export function refGlyph(ref: RefItem): string {
  return KIND_GLYPH[refMedia(ref)];
}

/** 渲染口径（缩略图字形 / 悬停预览用哪种控件），与决定 token 标签的 kind 分开。 */
function refMedia(ref: RefItem): RefKind {
  return ref.media ?? ref.kind ?? "image";
}

/** 序列化 token 文本，如「图片1」「视频2」。DOM 的 data-prompt-ref 直接存它，
 *  序列化时原样取回——避免「前缀 + 序号」在多处各拼一遍而走形。 */
export function refLabel(ref: RefItem): string {
  return KIND_LABEL[ref.kind ?? "image"] + ref.index;
}

/** 素材显示名：优先上游节点标题（拖入上传/我的素材都会写成文件名），
 *  节点未命名时退回「图片1」这类序号标签——缩略图下方不留空行，pill 悬停也不留空 title。 */
export function refCaption(ref: RefItem): string {
  return (ref.title || "").trim() || refLabel(ref);
}

const PREVIEW_W = 260;
/** 上方剩余空间少于这个高度就翻到下方——节点面板常贴屏幕底部，固定朝上会顶出视口 */
const PREVIEW_FLIP_H = 240;
const PREVIEW_EDGE = 8;
/** 开合各留一段延时：横扫缩略图行时不该一路弹窗；离开后留一手让鼠标能移进浮层
 *  （长文本要滚动、音频要点播放）。取值落在既有动效档位内。 */
const PREVIEW_OPEN_DELAY = 160;
const PREVIEW_CLOSE_DELAY = 120;

/** 悬停预览正文：四类素材各自的呈现方式完全不同——图片直出、视频静音循环、
 *  音频给原生控件、文本给可滚动正文。素材缺失（连了但还没生成）时给一句说明，
 *  不留空白浮层。 */
function RefPreviewBody({ refItem }: { refItem: RefItem }) {
  const media = refMedia(refItem);
  const url = (refItem.src || refItem.thumb || "").trim();
  const frame = "max-h-44 w-full rounded-md object-contain";

  if (media === "text") {
    const body = (refItem.text || "").trim();
    if (!body) return <p className="text-xs text-neutral-400">文本节点还没有内容</p>;
    return (
      <p className="max-h-44 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-6 text-neutral-700 dark:text-neutral-300">
        {body}
      </p>
    );
  }
  if (!url) return <p className="text-xs text-neutral-400">该素材还没有内容</p>;
  if (media === "video") {
    // 静音循环自动播放:悬停就能看清是哪段片子,又不会有声音突然响起来
    return <video src={url} muted loop autoPlay playsInline className={`${frame} bg-neutral-950`} />;
  }
  if (media === "audio") {
    return <audio src={url} controls preload="metadata" className="w-full" />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className={`${frame} bg-neutral-50 dark:bg-neutral-900`} />;
}

export function ReferenceThumb({ refItem, active, onPick }: { refItem: RefItem; active: boolean; onPick: (e: React.MouseEvent) => void }) {
  const caption = refCaption(refItem);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [preview, setPreview] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (openTimer.current) { window.clearTimeout(openTimer.current); openTimer.current = null; }
    if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  // 浮层走 portal + fixed:缩略图行是 overflow-x-auto,内联渲染会被它裁掉;
  // 且脱离画布的缩放变换后,预览在任何缩放级别下都是同一个可读尺寸。
  const openPreview = useCallback(() => {
    clearTimers();
    openTimer.current = window.setTimeout(() => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const left = Math.min(Math.max(PREVIEW_EDGE, rect.left), window.innerWidth - PREVIEW_W - PREVIEW_EDGE);
      setPreview(rect.top >= PREVIEW_FLIP_H
        ? { left, bottom: window.innerHeight - rect.top + PREVIEW_EDGE }
        : { left, top: rect.bottom + PREVIEW_EDGE });
    }, PREVIEW_OPEN_DELAY);
  }, [clearTimers]);

  const closePreview = useCallback(() => {
    clearTimers();
    closeTimer.current = window.setTimeout(() => setPreview(null), PREVIEW_CLOSE_DELAY);
  }, [clearTimers]);

  // 滚轮缩放画布时立刻收掉：浮层是 fixed 的，画布一缩放它就停在旧坐标上，
  // 与缩略图脱节地悬在半空。不拦冒泡，画布该缩放照缩放。
  const closePreviewNow = useCallback(() => {
    clearTimers();
    setPreview(null);
  }, [clearTimers]);

  return (
    // 列宽对齐左邻的「技能」按钮（同为 w-12），整行缩略图落在同一栅格上；
    // 44px 缩略图在 48px 列内居中，文件名占满列宽后截断，完整名在悬停预览里给全。
    // stopPropagation 提到外层：文件名那一行也在面板内，漏掉会让按住文件名拖动整个节点
    // （图片节点的提示词面板自身不拦 mousedown）。
    // 不挂原生 title：它与悬停预览同一触发点，两个浮层会前后脚一起冒出来。
    <span
      ref={anchorRef}
      className="flex w-12 shrink-0 flex-col items-center gap-1"
      onMouseDown={(e) => e.stopPropagation()}
      onMouseEnter={openPreview}
      onMouseLeave={closePreview}
      onWheel={closePreviewNow}
    >
      {preview && typeof document !== "undefined" && createPortal(
        <div
          // z 必须压过提示词放大弹层（PromptEditorModal 的 z-[200] 全屏 portal）——
          // 那里同样渲染缩略图行，层级低了预览会被它的遮罩盖住，等于悬停无反应。
          className="fixed z-[300] overflow-hidden rounded-[10px] border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
          style={{ width: PREVIEW_W, left: preview.left, top: preview.top, bottom: preview.bottom }}
          // 浮层自己也接管开合：鼠标移进来时取消待关闭，长文本才滚得动、音频才点得了
          onMouseEnter={clearTimers}
          onMouseLeave={closePreview}
          onMouseDown={(e) => e.stopPropagation()}
          // portal 里的事件仍会沿 React 树冒泡到上面那个 onWheel——不掐断的话，
          // 在预览里滚动长文本会把预览自己关掉。
          onWheel={(e) => e.stopPropagation()}
        >
          <RefPreviewBody refItem={refItem} />
          <div className="mt-2 flex items-baseline gap-2 border-t border-neutral-100 pt-2 dark:border-neutral-800">
            <span className="min-w-0 flex-1 break-all text-xs text-neutral-700 dark:text-neutral-200">{caption}</span>
            <span className="shrink-0 text-[11px] text-neutral-400">{refLabel(refItem)}</span>
          </div>
        </div>,
        document.body,
      )}
      <button
        onClick={onPick}
        aria-label={`引用 ${refLabel(refItem)}：${caption}`}
        className={`relative h-11 w-11 shrink-0 overflow-hidden rounded-lg border bg-neutral-100 transition-colors duration-150 dark:bg-neutral-800 ${
          active ? "border-blue-500 ring-2 ring-blue-400/40" : "border-neutral-200 hover:border-blue-400 hover:shadow-sm dark:border-neutral-700"
        }`}
      >
        {refItem.thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={refItem.thumb} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-sm text-neutral-400">{refGlyph(refItem)}</span>
        )}
        <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-neutral-900/85 px-1 text-[10px] font-semibold leading-none text-white">
          {refItem.index}
        </span>
      </button>
      <span className="w-full select-none truncate text-center text-[10px] leading-none text-neutral-500 dark:text-neutral-400">{caption}</span>
    </span>
  );
}

/** 「图片N / 视频N / 音频N」token。N 后不接数字（「图片1」不误命中「图片12」）。
 *  m[1]=类别前缀，m[2]=序号——两个捕获组，改动时注意下标。
 *
 *  类别与数字之间**不允许**空白（与创作台 MentionPromptEditor 同口径）：
 *  ① 「这组图片 3 秒」是普通行文，不该被当成引用；
 *  ② pill 一律序列化回无空白的「图片1」，若正则吃进空白，一次
 *     序列化→重建的往返就会把用户的空格甚至换行**永久吞掉**
 *     （「主体参考图片\n1、背景…」的换行会消失）；
 *  ③ 那样 value 也不再是 serialize∘sync 的不动点，聚焦态的等值判断会
 *     每次 refs 变化都误判成外部改写、重建 DOM 并把光标甩到末尾。 */
export const PROMPT_REF_TOKEN = /(图片|视频|音频|文本)(\d+)(?!\d)/g;

/** 序列化时按「一个块级元素 = 一行」处理的标签。
 *  必须按 tagName 判定而不是 getComputedStyle：textBeforePromptCaret 序列化的是
 *  cloneContents() 出来的**游离** DocumentFragment，其中计算样式无意义，按样式判
 *  会静默弄坏 @ 触发路径。 */
const PROMPT_BLOCK_TAGS = new Set(["DIV", "P", "PRE", "LI", "BLOCKQUOTE", "H1", "H2", "H3", "H4", "H5", "H6"]);

/** @ 触发查询（与创作台 MentionPromptEditor 同口径）：
 *  - 半角 @ 与全角 ＠ 都触发（中文输入法下打出的是全角）；
 *  - @ 前须是行首/空白/中文/pill 后的零宽空格等边界，前面是 ASCII 字母数字或
 *    邮箱类符号时不触发——「a@b.com」「vx@1对1」是字面文本，不该弹菜单；
 *  - 查询串不含空白/@/零宽空格，限 20 字。
 *  必须跑在 keepZwsp=true 的光标前文本上。m[1]=边界字符（不属于要吃掉的 @query），
 *  m[2]=查询串。 */
export const AT_QUERY_RE = new RegExp(
  "(^|[^A-Za-z0-9._%+\\-])[@＠]([^\\s@＠\\u200b]{0,20})$",
);

/** @ 候选菜单尺寸（Tailwind w-56 / max-h-48），用于溢出钳制与上下翻转判断。 */
export const MENTION_MENU_W = 224;
export const MENTION_MENU_MAX_H = 192;

export function createPromptRefElement(ref: RefItem) {
  const token = document.createElement("span");
  token.contentEditable = "false";
  token.dataset.promptRef = refLabel(ref);
  token.title = refCaption(ref);
  token.className =
    "mx-0.5 inline-flex h-6 max-w-[132px] items-center gap-1 rounded-md border border-neutral-200 bg-neutral-50 px-1 align-[-5px] text-xs font-medium text-neutral-800 shadow-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100";

  if (ref.thumb) {
    const img = document.createElement("img");
    img.src = ref.thumb;
    img.alt = "";
    img.className = "h-5 w-5 shrink-0 rounded-[4px] object-cover";
    token.appendChild(img);
  } else {
    const placeholder = document.createElement("span");
    placeholder.className = "h-5 w-5 shrink-0 rounded-[4px] bg-neutral-200 dark:bg-neutral-700";
    token.appendChild(placeholder);
  }

  const label = document.createElement("span");
  label.className = "truncate";
  label.textContent = refLabel(ref);
  token.appendChild(label);
  return token;
}

/** 把「@文件名」改写成规范 token 文本「图片N」。粘贴专用：用户从别处抄来的提示词里
 *  写的是人看得懂的名字（缩略图下方就是这么显示的），而全系统的唯一真值是「图片N」。
 *
 *  长名优先匹配——短名是长名前缀时（素材同时叫「角色」和「角色三视图」），
 *  按短的先匹配会把长名截成「图片1三视图」。 */
export function resolvePastedRefTokens(text: string, refs: RefItem[]): string {
  if (!text || refs.length === 0) return text;
  const names = refs
    .flatMap((ref) => [refCaption(ref), refLabel(ref)].map((key) => ({ key, ref })))
    .filter((n) => n.key.length > 0)
    .sort((a, b) => b.key.length - a.key.length);

  let out = "";
  for (let i = 0; i < text.length; ) {
    // 全角＠一并认：AT_QUERY_RE 也收，两条路径口径必须一致
    if (text[i] === "@" || text[i] === "＠") {
      const rest = text.slice(i + 1);
      const hit = names.find((n) => rest.startsWith(n.key));
      if (hit) {
        out += refLabel(hit.ref);
        i += 1 + hit.key.length;
        continue;
      }
    }
    out += text[i];
    i += 1;
  }
  return out;
}

/** 生成前把入边文本节点的正文落进提示词。图片/视频有 imageUrls / videoUrls 这种独立通道，
 *  文本没有——唯一的去处就是 prompt 正文，因此必须在提交前展开：
 *  - 提示词里出现的「文本N」原地替换成对应正文，出现位置由用户决定；
 *  - 连了但没被引用的，正文按连接顺序拼在描述最前面。与图片同口径「连进来即参与生成」，
 *    不必为了用上它再回输入框点一次。
 *  空白正文一律跳过，避免拼出前导空行。注意调用方筛选文本节点时必须**同样按 trim 判空**：
 *  两边口径不一致的话，只含空白的文本节点会白占一个「文本N」号，其后每个文本引用都错位，
 *  而且它还会让生成按钮亮起来（以为有提示词可发），最终发出去的却是空 prompt。 */
export function inlineTextRefs(prompt: string, texts: { label: string; content: string }[]): string {
  const usable = texts
    .map((t) => ({ label: t.label, content: t.content.trim() }))
    .filter((t) => t.content.length > 0);
  if (usable.length === 0) return prompt;

  const referenced = new Set<string>();
  // String.replace 对 /g 正则会自行归零 lastIndex，不像 exec/test 那样残留游标
  const body = prompt.replace(PROMPT_REF_TOKEN, (matched, prefix: string, index: string) => {
    // 前缀必须先判——图片/视频/音频有各自的下发通道，「图片1」是后端认得的位次约定，
    // 落进下面的删除分支会把用户的参考图引用一并抹掉。
    if (prefix !== "文本") return matched;
    const hit = usable.find((t) => t.label === prefix + index);
    // 悬空的「文本N」：对应文本节点已被断开或删除。它不像「图片N」那样有下发通道
    // 兜底，纯粹是客户端占位符，留着就是发给模型的一段乱码，就地抹掉。
    // 仅在本节点确有文本入边时才走到这里（见上方 early return），
    // 所以不会误伤"一个文本节点都没连、却把「文本1」当普通行文写进去"的提示词。
    if (!hit) return "";
    referenced.add(hit.label);
    return hit.content;
  });
  const leading = usable.filter((t) => !referenced.has(t.label)).map((t) => t.content);
  return [...leading, body.trim()].filter(Boolean).join("\n");
}

/** 提示词文本 → 编辑器子节点（「图片N」渲染成 pill，其余为文本节点）。
 *  失焦重建与粘贴插入共用，两条路径产出的 DOM 形态因此必然一致。 */
export function buildPromptNodes(prompt: string, refs: RefItem[]): ChildNode[] {
  const nodes: ChildNode[] = [];
  PROMPT_REF_TOKEN.lastIndex = 0;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = PROMPT_REF_TOKEN.exec(prompt)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(document.createTextNode(prompt.slice(lastIndex, match.index)));
    }

    // 按完整 label 全等匹配——只比序号会让「视频1」错绑到「图片1」。
    const label = match[1] + match[2];
    const ref = refs.find((item) => refLabel(item) === label);
    if (ref) {
      nodes.push(createPromptRefElement(ref));
      // pill 后必须补零宽空格:既是光标落点,也是「pill 之后」的 @ 触发边界——
      // AT_QUERY_RE 的 ASCII 排除类会把 pill 尾数字(图片1 的 1)当成非边界,
      // 少了它「pill 后紧跟 @」就唤不出菜单。重建路径必须与 insertRefToken
      // 插入路径产出同样的 DOM 形态(ZWSP 在序列化时剥掉,不影响 value)。
      nodes.push(document.createTextNode(ZERO_WIDTH_SPACE));
    } else {
      nodes.push(document.createTextNode(match[0]));
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < prompt.length) {
    nodes.push(document.createTextNode(prompt.slice(lastIndex)));
  }

  return nodes;
}

export function syncPromptEditorContent(editor: HTMLDivElement, prompt: string, refs: RefItem[]) {
  editor.replaceChildren(...buildPromptNodes(prompt, refs));
  // 内容以换行收尾时补一个占位符文本节点，复刻 Blink 自己敲出同样内容时的 DOM
  // 形态。否则 sync 写出的 DOM 没有占位符，serializePromptEditor 的剥离会把这个
  // **真实**的结尾换行吃掉，每次失焦重建就少一个换行（往返不幂等，等值判断也
  // 会因此持续误判）。
  if (prompt.endsWith("\n")) {
    editor.appendChild(document.createTextNode("\n"));
  }
}

/** keepZwsp=true 保留 pill 后的零宽空格——AT_QUERY_RE 靠它把「pill 紧跟的 @」
 *  识别为合法边界（否则 pill 序列化成「图片1」，末位数字会被判成邮箱类前缀）。 */
export function serializePromptNode(node: ChildNode, keepZwsp = false): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent || "";
    return keepZwsp ? text : text.split(ZERO_WIDTH_SPACE).join("");
  }
  if (!(node instanceof HTMLElement)) {
    return "";
  }
  // dataset 里存的就是完整 label（「图片1」/「视频2」），原样取回不再拼前缀
  if (node.dataset.promptRef) {
    return node.dataset.promptRef;
  }
  if (node.tagName === "BR") {
    return "\n";
  }
  // 浏览器原生编辑会注入块级容器：粘贴纯文本时 Chrome 给每一行包一个 <div>，
  // 粘 text/html 时还会带 <p>/<pre>/<li>。块级 = 一行（前面有内容则补换行）；
  // 行内唯一的结尾 <br> 是该行的占位而非额外换行（否则 <div><br></div> 空行
  // 会被算成两个换行）。少了这段，多行粘贴的换行会被无分隔拼接掉。
  const kids = Array.from(node.childNodes);
  const isBlock = PROMPT_BLOCK_TAGS.has(node.tagName);
  // 块内结尾的占位符有两种形态，都要剥：<br>，以及 pre-wrap 宿主里 Blink 为
  // Shift+Enter 产出的结尾 "\n" 文本节点。只处理了 <br> 的话，在粘贴产生的
  // <div> 里按一次 Shift+Enter 会提交两个换行（且 Backspace 撤销后还多留一个）。
  let trimTrailingNewline = false;
  if (isBlock && kids.length > 0) {
    const last = kids[kids.length - 1];
    if (last instanceof HTMLElement && last.tagName === "BR") kids.pop();
    else if (last.nodeType === Node.TEXT_NODE && (last.textContent || "").endsWith("\n")) trimTrailingNewline = true;
  }
  let inner = kids.map((child) => serializePromptNode(child, keepZwsp)).join("");
  if (trimTrailingNewline && inner.endsWith("\n")) inner = inner.slice(0, -1);
  return isBlock && node.previousSibling ? "\n" + inner : inner;
}

export function serializePromptEditor(editor: HTMLDivElement) {
  const text = Array.from(editor.childNodes)
    .map((node) => serializePromptNode(node))
    .join("")
    .split(NON_BREAKING_SPACE).join(" ");
  // 剥掉结尾的块级占位符：它是浏览器为「让最后一个换行可见」插入的，不是内容。
  // 不剥的话全选删空后 value 是 "\n" 而不是 ""，占位提示（!value）从此不出现，
  // node.prompt 也存成 "\n"。
  // 占位符在本编辑器有两种形态，都要认：
  //   · <br>——常规块级占位；
  //   · 结尾 "\n" 文本节点——pre-wrap 编辑宿主里 Shift+Enter 走 Blink 的
  //     preserve-newline 分支，产出的是文本节点而不是 <br>。
  // 结尾空行来自粘贴时 lastChild 是 DIV，不在此列，不会被误剥。
  // 与 syncPromptEditorContent 末尾的占位符回写成对：两者共同保证
  // value → sync → serialize 幂等（等值判断依赖这个不动点）。
  const last = editor.lastChild;
  const isPlaceholder =
    last instanceof HTMLElement
      ? last.tagName === "BR"
      : !!last && last.nodeType === Node.TEXT_NODE && (last.textContent || "").endsWith("\n");
  return isPlaceholder && text.endsWith("\n") ? text.slice(0, -1) : text;
}

/** 比较用归一化：两串在编辑器里是否**看起来完全一样**。
 *
 *  用途是判断「DOM 是否已经在显示这个 value」，所以只能抹掉**不可见**差异：
 *   · NBSP —— serializePromptEditor 会把它换成普通空格；
 *   · 零宽空格 —— pill 后的哨兵，序列化时本就剥掉。
 *
 *  刻意**不**在这里套 store 的 normalizePromptText（\uXXXX 解码）：那会把
 *  「你」和「你」判为相等，于是外部写入被当成无变化而跳过重建——编辑器
 *  继续显示转义原文，提交出去的却是解码后的另一串，用户看不见自己将要生成的
 *  内容。相比之下重建导致的光标跳到末尾只是体验问题，显示与提交不一致是正确性
 *  问题。宁可多重建一次。 */
export function normalizePromptForCompare(text: string): string {
  return text
    .split(NON_BREAKING_SPACE).join(" ")
    .split(ZERO_WIDTH_SPACE).join("");
}

export function getRangeInEditor(editor: HTMLDivElement, fallback?: Range | null) {
  const selection = window.getSelection();
  if (selection?.rangeCount) {
    const range = selection.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) {
      return range;
    }
  }
  if (fallback && editor.contains(fallback.commonAncestorContainer)) {
    return fallback.cloneRange();
  }
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  return range;
}

export function textBeforePromptCaret(editor: HTMLDivElement, keepZwsp = false) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return "";
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return "";
  const before = range.cloneRange();
  before.selectNodeContents(editor);
  before.setEnd(range.endContainer, range.endOffset);
  const fragment = before.cloneContents();
  return Array.from(fragment.childNodes).map((node) => serializePromptNode(node, keepZwsp)).join("");
}

export function placeCaretInsideText(node: Text, offset = node.length) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.setStart(node, Math.min(offset, node.length));
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

export interface CaretAnchor {
  /** 容器内局部坐标（CSS px），已钳制防右溢出 */
  left: number;
  /** 光标下缘：菜单向下展开时用作 top */
  top: number;
  /** 容器下缘到光标上缘的距离：菜单向上翻转时用作 bottom */
  bottom: number;
  /** 视口下方放不下 → 菜单应向上翻转（节点面板常贴屏幕底部） */
  flip: boolean;
}

/**
 * 计算 @ 浮层的锚点（容器内局部 CSS px）。
 *
 * 缩放系数从元素实测而非从 transform.k 推算：面板外层 NodeChrome 会做反向缩放
 * （damp=1 恒定屏幕尺寸、damp=0.6 阻尼），净缩放并不等于画布 zoom，按 zoom 换算
 * 会在缩放≠1 时把菜单锚偏。offsetWidth 是未经 transform 的布局宽度，与
 * getBoundingClientRect().width 之比即为该元素的实际总缩放，对画布/弹层/门户
 * 各场景一律成立。
 */
export function caretPosInEditor(editor: HTMLDivElement): CaretAnchor | null {
  const container = editor.parentElement;
  const selection = window.getSelection();
  if (!container || !selection?.rangeCount) return null;
  const range = selection.getRangeAt(0).cloneRange();
  range.collapse(true);
  let rect = range.getBoundingClientRect();
  if (!rect.width && !rect.height) {
    const rects = range.getClientRects();
    if (rects.length) rect = rects[rects.length - 1];
  }
  // 光标落在空文本/元素边界时 rect 仍可能为空，退回编辑器左上角兜底
  const base = !rect.width && !rect.height ? editor.getBoundingClientRect() : rect;
  const cRect = container.getBoundingClientRect();
  const scale = container.offsetWidth > 0 ? cRect.width / container.offsetWidth : 1;
  const k = scale > 0 ? scale : 1;
  const left = (base.left - cRect.left) / k;
  const maxLeft = Math.max(0, container.clientWidth - MENTION_MENU_W);
  // 屏幕空间判断用视口坐标与屏幕上的菜单高度（= 局部高度 × 实际缩放）
  const flip =
    base.bottom + MENTION_MENU_MAX_H * k > window.innerHeight &&
    base.top - MENTION_MENU_MAX_H * k > 0;
  return {
    left: Math.min(Math.max(0, left), maxLeft),
    top: (base.bottom - cRect.top) / k,
    bottom: (cRect.bottom - base.top) / k,
    flip,
  };
}
