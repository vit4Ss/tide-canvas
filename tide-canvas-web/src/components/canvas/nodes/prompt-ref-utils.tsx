"use client";

// 富文本提示词输入框的共享工具：「图片N」内联引用 token 的创建/序列化、光标处理、缩略图。
// 由图片节点与视频节点的 <PromptRefEditor> 共用（逻辑搬自 image-node，行为保持一致）。

export const LINE_HEIGHT = 24;
export const MIN_ROWS = 3;
export const MAX_ROWS = 4;

/** 来自入边连接的可引用图片 */
export interface RefItem {
  id: string;
  thumb: string;
  title: string;
  index: number;
}

export function ReferenceThumb({ refItem, active, onPick }: { refItem: RefItem; active: boolean; onPick: (e: React.MouseEvent) => void }) {
  return (
    <button
      onMouseDown={(e) => e.stopPropagation()}
      onClick={onPick}
      aria-label={`引用 图片${refItem.index}`}
      className={`relative h-11 w-11 shrink-0 overflow-hidden rounded-lg border bg-neutral-100 transition-colors duration-150 dark:bg-neutral-800 ${
        active ? "border-blue-500 ring-2 ring-blue-400/40" : "border-neutral-200 hover:border-blue-400 hover:shadow-sm dark:border-neutral-700"
      }`}
    >
      {refItem.thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={refItem.thumb} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-[10px] text-neutral-400">无图</span>
      )}
      <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-neutral-900/85 px-1 text-[10px] font-semibold leading-none text-white">
        {refItem.index}
      </span>
    </button>
  );
}

export const PROMPT_REF_TOKEN = /图片\s*(\d+)(?!\d)/g;

export function createPromptRefElement(ref: RefItem) {
  const token = document.createElement("span");
  token.contentEditable = "false";
  token.dataset.promptRef = String(ref.index);
  token.title = ref.title || `图片${ref.index}`;
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
  label.textContent = `图片${ref.index}`;
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

    const refIndex = Number(match[1]);
    const ref = refs.find((item) => item.index === refIndex);
    if (ref) {
      nodes.push(createPromptRefElement(ref));
    } else {
      nodes.push(document.createTextNode(match[0]));
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < prompt.length) {
    nodes.push(document.createTextNode(prompt.slice(lastIndex)));
  }

  editor.replaceChildren(...nodes);
}

export function serializePromptNode(node: ChildNode): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent || "").replace(/\u200B/g, "");
  }
  if (!(node instanceof HTMLElement)) {
    return "";
  }
  if (node.dataset.promptRef) {
    return `图片${node.dataset.promptRef}`;
  }
  if (node.tagName === "BR") {
    return "\n";
  }
  return Array.from(node.childNodes).map(serializePromptNode).join("");
}

export function serializePromptEditor(editor: HTMLDivElement) {
  return Array.from(editor.childNodes)
    .map(serializePromptNode)
    .join("")
    .replace(/\u00a0/g, " ");
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

export function textBeforePromptCaret(editor: HTMLDivElement) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return "";
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return "";
  const before = range.cloneRange();
  before.selectNodeContents(editor);
  before.setEnd(range.endContainer, range.endOffset);
  const fragment = before.cloneContents();
  return Array.from(fragment.childNodes).map(serializePromptNode).join("");
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

// 计算光标相对输入框容器的局部坐标（按画布缩放换算），用于把 @ 浮层锚定到光标正下方。
// 容器与光标的 getBoundingClientRect 都是含缩放的屏幕坐标，相减后 ÷zoom 还原为容器内 CSS px。
export function caretPosInEditor(editor: HTMLDivElement, zoom: number): { left: number; top: number } | null {
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
  const k = zoom || 1;
  const left = (base.left - cRect.left) / k;
  const top = (base.bottom - cRect.top) / k;
  // 防止浮层右溢出容器（下拉宽 w-56 = 224px）
  const maxLeft = Math.max(0, container.clientWidth - 224);
  return { left: Math.min(Math.max(0, left), maxLeft), top };
}
