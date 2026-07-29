"use client";

// 富文本提示词输入框的共享工具：「图片N / 视频N / 音频N」内联引用 token 的
// 创建/序列化、光标处理、缩略图。由画布的图片节点、视频节点与 AI 助手面板的
// <PromptRefEditor> 共用（逻辑搬自 image-node，行为保持一致）。
//
// token 词汇表与创作台 MentionPromptEditor 一致；两边各自实现是因为画布路由组
// 不加载 studio.css（(canvas)/layout.tsx 一行 CSS 都不 import，还主动摘掉 imini
// 类），.mention-* 依赖的主题变量在画布里不存在，只能走 Tailwind 内联。

export const LINE_HEIGHT = 24;
export const MIN_ROWS = 3;
export const MAX_ROWS = 4;

/** pill 后的哨兵字符(U+200B)：光标落点 + @ 触发边界。插入路径与重建路径共用
 *  同一常量，避免两边各写各的再次漂移。用 fromCharCode 避免源码出现不可见字符。 */
export const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
const NON_BREAKING_SPACE = String.fromCharCode(0x00a0);

export type RefKind = "image" | "video" | "audio";

const KIND_LABEL: Record<RefKind, string> = { image: "图片", video: "视频", audio: "音频" };

/** 无缩略图时的降级字形：视频节点只有 videoSrc（放进 <img> 是坏图），音频没有画面。 */
const KIND_GLYPH: Record<RefKind, string> = { image: "图", video: "▶", audio: "♪" };

export function refGlyph(ref: RefItem): string {
  return KIND_GLYPH[ref.kind ?? "image"];
}

/** 一条可引用素材：画布节点来自入边连接，助手面板来自已上传附件。 */
export interface RefItem {
  id: string;
  thumb: string;
  title: string;
  /** 同类素材内的 1 起序号——必须与提交时该类素材的顺序一致 */
  index: number;
  /** 省略即 image：图片/视频节点的既有调用点因此无需改动 */
  kind?: RefKind;
}

/** 序列化 token 文本，如「图片1」「视频2」。DOM 的 data-prompt-ref 直接存它，
 *  序列化时原样取回——避免「前缀 + 序号」在多处各拼一遍而走形。 */
export function refLabel(ref: RefItem): string {
  return KIND_LABEL[ref.kind ?? "image"] + ref.index;
}

export function ReferenceThumb({ refItem, active, onPick }: { refItem: RefItem; active: boolean; onPick: (e: React.MouseEvent) => void }) {
  return (
    <button
      onMouseDown={(e) => e.stopPropagation()}
      onClick={onPick}
      aria-label={`引用 ${refLabel(refItem)}`}
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
export const PROMPT_REF_TOKEN = /(图片|视频|音频)(\d+)(?!\d)/g;

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
  token.title = ref.title || refLabel(ref);
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

export function syncPromptEditorContent(editor: HTMLDivElement, prompt: string, refs: RefItem[]) {
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

  editor.replaceChildren(...nodes);
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
