"use client";

/* ============================================================================
   MentionPromptEditor — 创作台 (/studio) 与生成页 (/chat) 共用的提示词输入框
   + @ 引用系统。

   行为与画布节点的 PromptRefEditor 同源（IME 安全的 contentEditable 方案）：
     - 输入 @（含全角＠，且 @ 前须是行首/空白/pill 边界，句中字面 @ 不误触）
       弹出参考素材候选菜单（↑/↓/Enter/Esc 键盘导航 + 点击）；
     - 选中后在光标处插入带缩略图的内联 pill，序列化回「图片N / 视频N / 音频N」
       纯文本 token —— 与画布节点「图片N」同一约定，token 的 N 严格对齐提交时
       imageList / videoReferences / audioReferences 里的第 N 个素材；
     - 外部 value/refs 变化时重渲染（token 显示为 pill）。onChange 的回声用
       lastEmitted 判别：只有真正的外部写入（AI 优化 / 灵感 chip / 恢复草稿）
       才回写 DOM，用户打字永不被打断（保护中文输入法组字光标）。
   与画布版的差异：token 扩展到三种素材类型；菜单支持键盘导航；候选菜单按
   视口空间自动上翻（生成页输入框贴屏幕底部）；submitOnEnter 可关（创作台
   Enter 换行，生成页 Enter 发送）。

   换行模型：Enter 插入 <br>（行尾自动补一个占位 <br> 使新行立即可见——
   contentEditable 通行约定：结尾孤立 <br> 是占位不是换行，序列化时剥掉）。
   序列化后的 prompt 原样下发（后端/上游按位置对齐参考素材，同画布节点）。
   样式：.mention-* 系列在 styles/liuguang/studio.css（(studio) 布局全组加载）。
   ========================================================================== */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

/* ── token 词汇表 ─────────────────────────────────────────────────────────── */

export type MentionKind = "image" | "video" | "audio";

/** 一个可 @ 引用的参考素材（由页面按提交顺序编号后传入）。 */
export interface MentionRef {
  /** 稳定 key（用于 React 列表与去重） */
  key: string;
  kind: MentionKind;
  /** 同类素材中的 1 起序号 —— 必须与提交时该类素材列表的顺序一致 */
  index: number;
  /** 预览资源：image/video 为 URL；audio 可空（用音符字形占位） */
  thumb?: string;
  /** 序列化 token 文本，如「图片1」「视频2」 */
  label: string;
}

const MENTION_KIND_LABEL: Record<MentionKind, string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
};

/** 「图片N / 视频N / 音频N」token。不允许类别与数字间有空白（「这组图片 3 秒」
 *  是普通行文），N 后不接数字（「图片1」不误命中「图片12」）。注意这是无 @ 前缀
 *  的普通中文词，与画布节点同约定——「帮我生成图片1张」这类撞词行文在失焦时
 *  仍会被识别为引用，属位置 token 方案的已知取舍。 */
const TOKEN_RE = /(图片|视频|音频)(\d+)(?!\d)/g;

const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
const NON_BREAKING_SPACE = String.fromCharCode(0x00a0);

/** @ 触发查询：@ 前不能是 ASCII 字母/数字/邮箱类符号——「vx@1对1」「a@b.com」
 *  是字面文本不触发；行首、空白、中文（「把@」）、pill 后的零宽空格都算边界。
 *  查询串不含空白/@/零宽空格，限 20 字。跑在「保留零宽空格」的光标前文本上
 *  （textBeforeCaret keepZwsp），m[1]=边界字符（不属于要吃掉的 @query）。 */
const AT_QUERY_RE = new RegExp(
  "(^|[^A-Za-z0-9._%+\\-])[@＠]([^\\s@＠\\u200b]{0,20})$",
);

/* ── DOM 工具（与画布 prompt-ref-utils 同构，token 泛化到三种类型）──────────── */

/** pill 内的降级字形（无缩略图时）；菜单侧的降级与此保持一致。 */
const KIND_GLYPH: Record<MentionKind, string> = { image: "图", video: "▶", audio: "♪" };

/** 内容换行 <br>（带 data-nl 标记）。无标记的 <br> 只有两种来源：结尾占位
 *  （让最后一个换行可见）和浏览器原生编辑的残留——幽灵空态判定靠这个区分
 *  「用户故意留的空行」与「删除产物」。 */
function createNlBr(): HTMLBRElement {
  const br = document.createElement("br");
  br.dataset.nl = "1";
  return br;
}

/** node 之后（同层）是否还有可见内容（跳过空文本/纯零宽空格节点）。 */
function hasVisibleContentAfter(node: ChildNode): boolean {
  let after: ChildNode | null = node.nextSibling;
  while (after) {
    const emptyText =
      after.nodeType === Node.TEXT_NODE &&
      (after.textContent || "").split(ZERO_WIDTH_SPACE).join("") === "";
    if (!emptyText) return true;
    after = after.nextSibling;
  }
  return false;
}

/** 从任意文本提取「图片N/视频N/音频N」token 集合（AI 优化等外部比较用）。 */
export function extractMentionTokens(text: string): Set<string> {
  const out = new Set<string>();
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(text || "")) !== null) out.add(m[0]);
  return out;
}

function createPillElement(ref: MentionRef): HTMLSpanElement {
  const pill = document.createElement("span");
  pill.contentEditable = "false";
  pill.dataset.mention = ref.label;
  pill.title = ref.label;
  pill.className = "mention-pill";
  if (ref.kind === "image" && ref.thumb) {
    const img = document.createElement("img");
    img.src = ref.thumb;
    img.alt = "";
    pill.appendChild(img);
  } else {
    // 视频/音频用静态字形：16px 下视频首帧不可辨识，而活的 <video> 每次
    // 创建/克隆/重建都会重新发起 metadata 请求（OSS 计流量），得不偿失。
    const ic = document.createElement("span");
    ic.className = "mp-ic";
    ic.textContent = KIND_GLYPH[ref.kind];
    pill.appendChild(ic);
  }
  const label = document.createElement("span");
  label.className = "mp-label";
  label.textContent = ref.label;
  pill.appendChild(label);
  return pill;
}

/** 把 prompt 文本渲染进编辑器：能匹配到素材的 token 变 pill，其余保持纯文本。
 *  换行统一渲染为 <br>（与 insertNewline 的模型一致——pre-wrap 下「文本尾 \n
 *  紧跟 <br>」的混合形态视觉行为不确定），结尾换行后补占位 <br> 使其可见。 */
function syncEditorContent(editor: HTMLDivElement, prompt: string, refs: MentionRef[]) {
  const byLabel = new Map(refs.map((r) => [r.label, r]));
  const nodes: ChildNode[] = [];
  const pushText = (str: string) => {
    const parts = str.split("\n");
    parts.forEach((p, i) => {
      if (i > 0) nodes.push(createNlBr());
      if (p) nodes.push(document.createTextNode(p));
    });
  };
  TOKEN_RE.lastIndex = 0;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(prompt)) !== null) {
    if (m.index > last) pushText(prompt.slice(last, m.index));
    const ref = byLabel.get(m[0]);
    if (ref) {
      nodes.push(createPillElement(ref));
      // pill 后跟零宽空格：既是光标落点，也是「pill 之后」的 @ 触发边界
      // （AT_QUERY_RE 的 ASCII 排除类会把 pill 尾数字当非边界）——重建路径
      // 必须和 insertMention 插入路径产出同样的 DOM 形态。
      nodes.push(document.createTextNode(ZERO_WIDTH_SPACE));
    } else {
      nodes.push(document.createTextNode(m[0]));
    }
    last = m.index + m[0].length;
  }
  if (last < prompt.length) pushText(prompt.slice(last));
  // 结尾换行需要一个额外的占位 <br> 才可见（serializeEditor 会剥掉；不标
  // data-nl——它不是内容）。
  if (prompt.endsWith("\n")) nodes.push(document.createElement("br"));
  editor.replaceChildren(...nodes);
}

function serializeNode(node: ChildNode, keepZwsp = false): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = node.textContent || "";
    return keepZwsp ? t : t.split(ZERO_WIDTH_SPACE).join("");
  }
  if (!(node instanceof HTMLElement)) return "";
  if (node.dataset.mention) return node.dataset.mention;
  if (node.tagName === "BR") return "\n";
  // 浏览器原生编辑（拖放/撤销/移动端 IME 的原生 Enter）可能产生 <div> 段落：
  // 块级 = 一行（前面有内容则补换行）；行内唯一的结尾 <br> 是该行的占位而非
  // 额外换行（否则 <div><br></div> 空行会被算成两个换行）。
  const kids = Array.from(node.childNodes);
  if (node.tagName === "DIV" && kids.length > 0) {
    const lastKid = kids[kids.length - 1];
    if (lastKid instanceof HTMLElement && lastKid.tagName === "BR") kids.pop();
  }
  const inner = kids.map((k) => serializeNode(k, keepZwsp)).join("");
  if (node.tagName === "DIV") return (node.previousSibling ? "\n" : "") + inner;
  return inner;
}

function serializeEditor(editor: HTMLDivElement): string {
  let text = Array.from(editor.childNodes)
    .map((n) => serializeNode(n))
    .join("")
    .split(NON_BREAKING_SPACE)
    .join(" ");
  // 结尾孤立 <br> 是占位（让最后一个换行可见），不是内容换行。
  const last = editor.lastChild;
  if (last instanceof HTMLElement && last.tagName === "BR" && text.endsWith("\n")) {
    text = text.slice(0, -1);
  }
  return text;
}

/** 幽灵空态：没有 pill、没有文本、也没有任何「内容换行」（br[data-nl]），
 *  却残留 <br>/<div><br></div> 等删除产物（会被序列化成 "\n"，导致占位符
 *  不出现、字数不归零）。用户故意留的空行（Enter 产生的 data-nl br）不误伤。 */
function isGhostEmpty(editor: HTMLDivElement): boolean {
  if (editor.childNodes.length === 0) return false;
  if (editor.querySelector("[data-mention]")) return false;
  if (editor.querySelector("br[data-nl]")) return false;
  return (editor.textContent || "").split(ZERO_WIDTH_SPACE).join("") === "";
}

/** 编辑器纯文本部分是否含有能绑定到素材的「图片N」token——失焦时只有存在
 *  待 pill 化的 token 才值得全量重建 DOM。pill 用哨兵字符占位、换行保留为
 *  \n，避免「这张图片<br>1秒」被无分隔拼接成假 token 触发无谓重建。 */
function hasUnpilledToken(editor: HTMLDivElement, refs: MentionRef[]): boolean {
  if (!refs.length) return false;
  const labels = new Set(refs.map((r) => r.label));
  const plain = (node: ChildNode): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent || "").split(ZERO_WIDTH_SPACE).join("");
    }
    if (!(node instanceof HTMLElement)) return "";
    if (node.dataset.mention) return " "; // pill 哨兵：隔断相邻文本
    if (node.tagName === "BR") return "\n";
    const inner = Array.from(node.childNodes).map(plain).join("");
    return node.tagName === "DIV" ? "\n" + inner : inner;
  };
  const text = Array.from(editor.childNodes).map(plain).join("");
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    if (labels.has(m[0])) return true;
  }
  return false;
}

function getRangeInEditor(editor: HTMLDivElement, fallback?: Range | null): Range {
  const selection = window.getSelection();
  if (selection?.rangeCount) {
    const range = selection.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) return range;
  }
  if (fallback && editor.contains(fallback.commonAncestorContainer)) return fallback.cloneRange();
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  return range;
}

/** 光标前的序列化文本（pill 计为其 token），用于探测进行中的 @ 查询。
 *  keepZwsp=true 保留零宽空格——AT_QUERY_RE 靠它识别「pill 后紧跟的 @」。 */
function textBeforeCaret(editor: HTMLDivElement, keepZwsp = false): string {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return "";
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return "";
  const before = range.cloneRange();
  before.selectNodeContents(editor);
  before.setEnd(range.endContainer, range.endOffset);
  const fragment = before.cloneContents();
  return Array.from(fragment.childNodes)
    .map((n) => serializeNode(n, keepZwsp))
    .join("");
}

function placeCaretAfter(node: ChildNode) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function placeCaretInText(node: Text, offset = node.length) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.setStart(node, Math.min(offset, node.length));
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** 光标相对容器的局部坐标 + 视口坐标（供菜单锚定与上下翻转判断）。 */
function caretAnchor(editor: HTMLDivElement, container: HTMLElement) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0).cloneRange();
  range.collapse(true);
  let rect = range.getBoundingClientRect();
  if (!rect.width && !rect.height) {
    const rects = range.getClientRects();
    if (rects.length) rect = rects[rects.length - 1];
  }
  const base = !rect.width && !rect.height ? editor.getBoundingClientRect() : rect;
  const cRect = container.getBoundingClientRect();
  return {
    left: base.left - cRect.left,
    top: base.top - cRect.top,
    bottom: base.bottom - cRect.top,
    viewportTop: base.top,
    viewportBottom: base.bottom,
  };
}

/* ── 组件 ─────────────────────────────────────────────────────────────────── */

export interface MentionEditorHandle {
  focus: () => void;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** 可引用素材（空数组 = @ 不触发菜单，@ 保持字面输入） */
  refs: MentionRef[];
  placeholder?: string;
  /** Enter（非组字、菜单未开）触发；submitOnEnter=false 时 Enter 为换行 */
  onSubmit?: () => void;
  submitOnEnter?: boolean;
  /** 粘贴板里有文件时调用（生成页：粘贴图片直接挂参考素材）；未传则忽略文件 */
  onPasteFiles?: (files: FileList) => void;
  /** 编辑器 className（页面各自的字体/内边距/高度样式） */
  className?: string;
  id?: string;
}

export const MentionPromptEditor = forwardRef<MentionEditorHandle, Props>(
  function MentionPromptEditor(
    { value, onChange, refs, placeholder, onSubmit, submitOnEnter = true, onPasteFiles, className = "", id },
    handleRef,
  ) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<HTMLDivElement>(null);
    const savedRangeRef = useRef<Range | null>(null);
    const composingRef = useRef(false);
    // IME 下 document.activeElement 会瞬时漂移，用 onFocus/onBlur 记聚焦态
    const focusedRef = useRef(false);
    // 回声判别：onChange 发出的值记在这里；外部同步 effect 里 value 等于它
    // 就是自己序列化的回声（用户在打字），不回写 DOM——真正的外部写入
    // （AI 优化 / 灵感 chip / 恢复草稿）才重渲染。初始为 null 哨兵：挂载时
    // 无论 value 是什么都不算回声，首轮 effect 必渲染（否则「挂载即有值且
    // refs 为空」时编辑器会一直空着）。
    const lastEmittedRef = useRef<string | null>(null);
    // 上次渲染进 DOM 的 refs 签名（label+缩略图）：refs 仅引用变化、内容没变时
    // 跳过全量重建，避免上传进度 tick 反复销毁重建 pill 的 <img>。
    const lastRefsSigRef = useRef("");
    // 组字期间到达的外部 value 写入（如 AI 优化异步返回）先暂存，
    // compositionEnd 再应用——组字中回写 DOM 会打断输入法。
    const pendingExternalRef = useRef<string | null>(null);

    const [menuOpen, setMenuOpen] = useState(false);
    const [menuQuery, setMenuQuery] = useState("");
    const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);
    const [menuIndex, setMenuIndex] = useState(0);
    const activeItemRef = useRef<HTMLButtonElement | null>(null);

    const refsSig = useMemo(
      () => refs.map((r) => `${r.label}|${r.kind}|${r.thumb ?? ""}`).join(","),
      [refs],
    );

    // 同一素材允许 @ 多次（「把图片1的背景和图片1的主体分开处理」），
    // 候选只按输入的查询串过滤，不按「是否已引用」过滤。
    const menuList = useMemo(() => {
      const q = menuQuery.trim();
      if (!q) return refs;
      return refs.filter(
        (r) => r.label.includes(q) || String(r.index) === q || MENTION_KIND_LABEL[r.kind].includes(q),
      );
    }, [refs, menuQuery]);

    // ↑/↓ 高亮行保持可见
    useEffect(() => {
      if (menuOpen) activeItemRef.current?.scrollIntoView({ block: "nearest" });
    }, [menuIndex, menuOpen]);

    const closeMenu = useCallback(() => {
      setMenuOpen(false);
      setMenuQuery("");
    }, []);

    /** 菜单定位：默认在光标下方；下方视口空间不足时翻到光标上方。 */
    const placeMenu = useCallback(() => {
      const editor = editorRef.current;
      const wrap = wrapRef.current;
      if (!editor || !wrap) return null;
      const a = caretAnchor(editor, wrap);
      if (!a) return null;
      const menuH = Math.min(248, 44 + Math.max(1, menuList.length) * 46);
      const menuW = 240;
      const openUp = a.viewportBottom + 8 + menuH > window.innerHeight - 8;
      const top = openUp ? a.top - menuH - 6 : a.bottom + 6;
      const maxLeft = Math.max(0, wrap.clientWidth - menuW);
      return { left: Math.min(Math.max(0, a.left), maxLeft), top };
      // menuList.length 影响估高 → 依赖它
    }, [menuList.length]);

    const saveSelection = useCallback(() => {
      const editor = editorRef.current;
      const selection = window.getSelection();
      if (editor && selection?.rangeCount && editor.contains(selection.getRangeAt(0).commonAncestorContainer)) {
        savedRangeRef.current = selection.getRangeAt(0).cloneRange();
      }
    }, []);

    /** 按光标处的 @ 查询开/关/更新菜单（输入、光标移动、点击共用）。
     *  组字中不动菜单（既不开也不关）：拼音过滤时菜单闪关会打断主用户群的
     *  输入流，组字结束的 compositionEnd 会重新同步。 */
    const syncMenuFromCaret = useCallback(() => {
      const editor = editorRef.current;
      if (!editor || refs.length === 0) {
        setMenuOpen(false);
        return;
      }
      if (composingRef.current) return;
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) {
        setMenuOpen(false);
        return;
      }
      const m = AT_QUERY_RE.exec(textBeforeCaret(editor, true));
      if (m) {
        setMenuQuery(m[2]);
        setMenuIndex(0);
        setMenuOpen(true);
        setMenuPos(placeMenu());
      } else {
        setMenuOpen(false);
      }
    }, [refs.length, placeMenu]);

    const emit = useCallback(
      (text: string) => {
        lastEmittedRef.current = text;
        onChange(text);
      },
      [onChange],
    );

    /** 每次编辑提交后：序列化回 onChange，并按光标处的 @ 查询开/关菜单。 */
    const updateFromEditor = useCallback(() => {
      const editor = editorRef.current;
      if (!editor) return;
      // 删除操作的幽灵残留（<br> / <div><br></div>）归一化成真正的空
      if (isGhostEmpty(editor)) editor.replaceChildren();
      saveSelection();
      emit(serializeEditor(editor));
      syncMenuFromCaret();
    }, [saveSelection, emit, syncMenuFromCaret]);

    /** 在光标处插入引用 pill（吃掉已输入的 @query），后接零宽空格作光标落点。 */
    const insertMention = useCallback(
      (ref: MentionRef) => {
        const editor = editorRef.current;
        if (!editor) return;
        editor.focus();
        const range = getRangeInEditor(editor, savedRangeRef.current);
        range.deleteContents();
        const m = AT_QUERY_RE.exec(textBeforeCaret(editor, true));
        if (m && range.startContainer.nodeType === Node.TEXT_NODE) {
          // 删除「@ + 查询串」（m[1] 是边界字符，不属于查询，不能删）。
          // 查询串可能跨文本节点（如键入 @ 后粘贴出的新节点），向前逐节点删，
          // 遇到非文本边界（pill/br）防御性停删。
          let remaining = 1 + m[2].length;
          let node: ChildNode = range.startContainer as Text;
          let offset = range.startOffset;
          for (;;) {
            const del = Math.min(offset, remaining);
            (node as Text).deleteData(offset - del, del);
            remaining -= del;
            range.setStart(node, offset - del);
            range.collapse(true);
            if (remaining <= 0) break;
            const prev = node.previousSibling;
            if (!prev || prev.nodeType !== Node.TEXT_NODE) break;
            node = prev;
            offset = (prev.textContent || "").length;
          }
        }
        const pill = createPillElement(ref);
        const caretText = document.createTextNode(ZERO_WIDTH_SPACE);
        range.insertNode(pill);
        pill.after(caretText);
        placeCaretInText(caretText, caretText.length);
        closeMenu();
        // 插入后重序列化（不重开菜单：@ 查询已被吃掉，不再成立）
        saveSelection();
        emit(serializeEditor(editor));
      },
      [closeMenu, saveSelection, emit],
    );

    // 纯文本插入（粘贴/拖放）：\r\n 归一化（Windows 剪贴板是 CRLF，\r 混进
    // value 会污染字数与下发 prompt），换行转 data-nl <br> 与整个编辑器的
    // 换行模型保持一致（文本节点里藏 \n 会让「结尾换行不可见」旧病复发）。
    const insertPlainText = useCallback(
      (raw: string) => {
        const editor = editorRef.current;
        if (!editor) return;
        const text = raw.replace(/\r\n?/g, "\n");
        if (!text) return;
        const range = getRangeInEditor(editor, savedRangeRef.current);
        range.deleteContents();
        const frag = document.createDocumentFragment();
        let lastNode: ChildNode | null = null;
        text.split("\n").forEach((p, i) => {
          if (i > 0) {
            const br = createNlBr();
            frag.appendChild(br);
            lastNode = br;
          }
          if (p) {
            const t = document.createTextNode(p);
            frag.appendChild(t);
            lastNode = t;
          }
        });
        if (!lastNode) return;
        range.insertNode(frag);
        const endNode: ChildNode = lastNode;
        // 以换行收尾且其后无可见内容 → 补占位 <br> 让结尾空行可见
        if (endNode instanceof HTMLElement && endNode.tagName === "BR" && !hasVisibleContentAfter(endNode)) {
          editor.appendChild(document.createElement("br"));
        }
        if (endNode.nodeType === Node.TEXT_NODE) placeCaretInText(endNode as Text);
        else placeCaretAfter(endNode);
        saveSelection();
      },
      [saveSelection],
    );

    // 换行：插入 <br>；若已到内容末尾再补一个占位 <br>（contentEditable 通行
    // 约定：结尾孤立 <br> 让新行立即可见，序列化时剥掉）。用 <br> 而不是 "\n"
    // 文本：退格删除是原生行为（无零宽空格死键），DOM 里也不累积不可见字符。
    const insertNewline = useCallback(() => {
      const editor = editorRef.current;
      if (!editor) return;
      const range = getRangeInEditor(editor, savedRangeRef.current);
      range.deleteContents();
      const br = createNlBr();
      range.insertNode(br);
      // <br> 后没有任何可见内容（Range.insertNode 分裂文本节点可能留下空文本
      // 节点，得跳过）→ 在编辑器末尾补占位 <br>（不标 data-nl），否则新行不可见。
      if (!hasVisibleContentAfter(br)) editor.appendChild(document.createElement("br"));
      placeCaretAfter(br);
      saveSelection();
    }, [saveSelection]);

    const onKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLDivElement>) => {
        // 组字中 Enter/Tab 是输入法选词，绝不发送/选中候选
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        // menuPos 为 null 时菜单并未渲染（锚点计算失败），不能让 Enter 隔空选中
        if (menuOpen && menuPos && menuList.length > 0) {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setMenuIndex((i) => (i + 1) % menuList.length);
            return;
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setMenuIndex((i) => (i - 1 + menuList.length) % menuList.length);
            return;
          }
          if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            insertMention(menuList[Math.min(menuIndex, menuList.length - 1)]);
            return;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            closeMenu();
            return;
          }
        } else if (menuOpen && e.key === "Escape") {
          e.preventDefault();
          closeMenu();
          return;
        }
        if (e.key === "Enter") {
          // contentEditable 默认 Enter 会包 <div>；统一改为手动插入 <br>，
          // 序列化器的主路径只需理解 文本/BR/pill 三种节点
          e.preventDefault();
          if (submitOnEnter && !e.shiftKey) {
            onSubmit?.();
            return;
          }
          insertNewline();
          updateFromEditor();
        }
      },
      [menuOpen, menuPos, menuList, menuIndex, insertMention, closeMenu, submitOnEnter, onSubmit, insertNewline, updateFromEditor],
    );

    const onPaste = useCallback(
      (e: React.ClipboardEvent<HTMLDivElement>) => {
        e.preventDefault();
        const files = e.clipboardData?.files;
        if (files && files.length && onPasteFiles) {
          onPasteFiles(files);
          return;
        }
        // 富文本粘贴降级为纯文本，防止外部 HTML 混进编辑器
        const text = e.clipboardData?.getData("text/plain") ?? "";
        if (text) {
          insertPlainText(text);
          updateFromEditor();
        }
      },
      [onPasteFiles, insertPlainText, updateFromEditor],
    );

    // 拖放文本同样降级为纯文本（drop 不走 paste 事件，默认行为会把
    // <div>/<span> 富文本结构直接注入编辑器）。文件拖放交给页面级 onDrop
    // （生成页 composer 已有），这里只拦文本。
    const onDrop = useCallback(
      (e: React.DragEvent<HTMLDivElement>) => {
        if (e.dataTransfer?.files?.length) return; // 文件走页面级处理
        e.preventDefault();
        const text = e.dataTransfer?.getData("text/plain") ?? "";
        if (!text) return;
        const editor = editorRef.current;
        editor?.focus();
        insertPlainText(text);
        updateFromEditor();
      },
      [insertPlainText, updateFromEditor],
    );

    // 光标移动后重测 @ 查询：菜单跟随光标开/关，避免"菜单还开着、光标已移走，
    // Enter 把 pill 插到新位置且旧 @query 残留"。菜单开着时 ↑/↓ 是候选导航
    // （keydown 已消费），keyup 不重测，否则高亮行会被重置回第一行。
    const onEditorKeyUp = useCallback(
      (e: React.KeyboardEvent<HTMLDivElement>) => {
        saveSelection();
        const k = e.key;
        if (
          k === "ArrowLeft" || k === "ArrowRight" || k === "Home" || k === "End" ||
          k === "PageUp" || k === "PageDown" ||
          (!menuOpen && (k === "ArrowUp" || k === "ArrowDown"))
        ) {
          syncMenuFromCaret();
        }
      },
      [saveSelection, menuOpen, syncMenuFromCaret],
    );

    const onEditorMouseUp = useCallback(() => {
      saveSelection();
      syncMenuFromCaret();
    }, [saveSelection, syncMenuFromCaret]);

    // 外部 value/refs 同步。回声（value === 自己刚 emit 的值）且 refs 内容
    // 未变 → 不动 DOM，用户打字/组字永不被重建打断。真正的外部写入
    // （AI 优化、灵感 chip、恢复草稿、发送后清空）→ 重渲染；聚焦中光标置尾。
    // refs 内容变化（上传完成换 URL、增删素材）仅在未聚焦时重建——聚焦中
    // 重建会把光标甩到结尾，缩略图的更新等失焦再补。
    useEffect(() => {
      const editor = editorRef.current;
      if (!editor) return;
      const v = value || "";
      const isEcho = v === lastEmittedRef.current;
      if (composingRef.current) {
        // 组字中不能回写 DOM；真正的外部写入暂存，compositionEnd 应用
        if (!isEcho) pendingExternalRef.current = v;
        return;
      }
      const sigSame = refsSig === lastRefsSigRef.current;
      if (isEcho && sigSame) return;
      if (isEcho && !sigSame && focusedRef.current) return; // refs-only 变化，聚焦中不打断
      syncEditorContent(editor, v, refs);
      lastEmittedRef.current = v;
      lastRefsSigRef.current = refsSig;
      if (focusedRef.current) {
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value, refsSig]);

    // 菜单开着时点击外部收起
    useEffect(() => {
      if (!menuOpen) return;
      const onDown = (e: MouseEvent) => {
        if (!(e.target instanceof Element) || !e.target.closest(".mention-menu")) {
          if (!(e.target instanceof Element) || !editorRef.current?.contains(e.target)) closeMenu();
        }
      };
      document.addEventListener("mousedown", onDown);
      return () => document.removeEventListener("mousedown", onDown);
    }, [menuOpen, closeMenu]);

    useImperativeHandle(handleRef, () => ({
      focus: () => {
        const editor = editorRef.current;
        if (!editor) return;
        editor.focus();
        // 光标置尾（恢复/带入提示词后接着写）
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      },
    }), []);

    const showPlaceholder = !value;

    return (
      <div className="mention-wrap" ref={wrapRef}>
        {showPlaceholder && (
          <span aria-hidden className={`mention-ph ${className}`}>
            {placeholder}
          </span>
        )}
        <div
          ref={editorRef}
          id={id}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={placeholder}
          spellCheck={false}
          className={`mention-editor ${className}`}
          onInput={updateFromEditor}
          onKeyDown={onKeyDown}
          onKeyUp={onEditorKeyUp}
          onMouseUp={onEditorMouseUp}
          onPaste={onPaste}
          onDrop={onDrop}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
            // 组字期间到达的外部写入（AI 优化等用户主动触发的结果）优先应用；
            // 否则正常提交刚组好的字
            const pending = pendingExternalRef.current;
            pendingExternalRef.current = null;
            const editor = editorRef.current;
            if (pending != null && editor) {
              syncEditorContent(editor, pending, refs);
              lastEmittedRef.current = pending;
              lastRefsSigRef.current = refsSig;
              const range = document.createRange();
              range.selectNodeContents(editor);
              range.collapse(false);
              const selection = window.getSelection();
              selection?.removeAllRanges();
              selection?.addRange(range);
              return;
            }
            updateFromEditor();
          }}
          onFocus={() => {
            focusedRef.current = true;
            const editor = editorRef.current;
            if (editor && !editor.childNodes.length && value) {
              syncEditorContent(editor, value, refs);
            }
          }}
          onBlur={() => {
            focusedRef.current = false;
            const editor = editorRef.current;
            if (editor) {
              const prompt = serializeEditor(editor);
              emit(prompt);
              // 失焦时把手敲/粘贴出来的「图片N」文本渲染成 pill；refs 有变化
              // （上传完成/增删素材）也补一次重建让缩略图跟上。两者都没有就
              // 不动 DOM，避免每次失焦都销毁重建 <img>。
              if (hasUnpilledToken(editor, refs) || refsSig !== lastRefsSigRef.current) {
                syncEditorContent(editor, prompt, refs);
                lastRefsSigRef.current = refsSig;
              }
            }
            savedRangeRef.current = null;
            // 延迟收起：先让菜单项的 mousedown/click 有机会命中
            setTimeout(() => setMenuOpen(false), 120);
          }}
        />

        {/* 容器整体 mousedown preventDefault：点滚动条/表头拖动都不能让编辑器
            失焦（失焦会清 savedRange 并在 120ms 后自关菜单） */}
        {menuOpen && menuList.length > 0 && menuPos && (
          <div
            className="mention-menu"
            style={{ left: menuPos.left, top: menuPos.top }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <div className="mention-menu-h">引用参考素材</div>
            {menuList.map((r, i) => (
              <button
                key={r.key}
                ref={i === menuIndex ? activeItemRef : null}
                type="button"
                className={`mention-item${i === menuIndex ? " on" : ""}`}
                onMouseEnter={() => setMenuIndex(i)}
                onClick={() => insertMention(r)}
              >
                {r.kind === "image" && r.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.thumb} alt="" />
                ) : r.kind === "video" && r.thumb ? (
                  <video src={r.thumb} muted playsInline preload="metadata" />
                ) : (
                  <span className="mi-ic">{KIND_GLYPH[r.kind]}</span>
                )}
                <span className="mi-lab">{r.label}</span>
                <span className="mi-at">@{r.index}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  },
);

/** 按提交顺序给素材编号并生成 MentionRef 列表（页面侧共用的小工具）。 */
export function buildMentionRefs(
  items: { key?: string; kind: MentionKind; thumb?: string }[],
): MentionRef[] {
  const count: Record<MentionKind, number> = { image: 0, video: 0, audio: 0 };
  return items.map((it, i) => {
    count[it.kind] += 1;
    const index = count[it.kind];
    return {
      key: it.key ?? `${it.kind}-${i}-${it.thumb ?? ""}`,
      kind: it.kind,
      index,
      thumb: it.thumb,
      label: `${MENTION_KIND_LABEL[it.kind]}${index}`,
    };
  });
}
