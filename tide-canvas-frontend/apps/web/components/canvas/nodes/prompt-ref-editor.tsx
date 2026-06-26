"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import {
  type RefItem,
  ReferenceThumb,
  LINE_HEIGHT,
  MIN_ROWS,
  MAX_ROWS,
  serializePromptEditor,
  textBeforePromptCaret,
  caretPosInEditor,
  getRangeInEditor,
  createPromptRefElement,
  placeCaretInsideText,
  syncPromptEditorContent,
} from "./prompt-ref-utils";

interface Props {
  value: string;
  onChange: (value: string) => void;
  refs: RefItem[];
  /** 当前画布缩放，用于把 @ 浮层锚定到光标处 */
  zoom: number;
  placeholder?: string;
  /** 回车（非换行、非输入法组合、@ 下拉未开）触发 */
  onSubmit?: () => void;
  /** true=flex-1 填充剩余空间（视频节点）；false=按 MIN/MAX_ROWS 固定高（图片节点） */
  fill?: boolean;
  /** 缩略图行最前的节点专属按钮（风格/标记/聚焦、标记/运镜/角色库 等） */
  leading?: React.ReactNode;
  /** 缩略图行右侧按钮（如展开） */
  trailing?: React.ReactNode;
}

const stop = (e: React.MouseEvent) => e.stopPropagation();

/**
 * 富文本提示词输入框 + @ 引用系统：「图片N」以带缩略图的内联 pill 呈现，序列化回「图片N」文本。
 * 图片节点与视频节点共用（见 prompt-ref-utils 中搬移的纯函数）。
 */
export function PromptRefEditor({ value, onChange, refs, zoom, placeholder, onSubmit, fill = false, leading, trailing }: Props) {
  const promptEditorRef = useRef<HTMLDivElement>(null);
  const promptRangeRef = useRef<Range | null>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  // @ 浮层锚点：光标相对输入框容器的局部坐标（按缩放换算），令下拉悬浮在光标正下方
  const [mentionPos, setMentionPos] = useState<{ left: number; top: number } | null>(null);

  // 引用以 prompt 文本为唯一数据源：「图片N」是否已存在（N 后不接数字，避免「图片1」误命中「图片12」）
  const promptHasRef = useCallback(
    (index: number) => new RegExp(`图片${index}(?!\\d)`).test(value || ""),
    [value]
  );
  const mentionList = useMemo(
    () => refs.filter(
      (r) => !promptHasRef(r.index) && (!mentionQuery || `图片${r.index}`.includes(mentionQuery) || String(r.index) === mentionQuery)
    ),
    [refs, promptHasRef, mentionQuery]
  );

  const updatePromptFromEditor = useCallback(() => {
    const editor = promptEditorRef.current;
    if (!editor) return;
    const selection = window.getSelection();
    if (selection?.rangeCount && editor.contains(selection.getRangeAt(0).commonAncestorContainer)) {
      promptRangeRef.current = selection.getRangeAt(0).cloneRange();
    }
    const prompt = serializePromptEditor(editor);
    onChange(prompt);
    const beforeCaret = textBeforePromptCaret(editor);
    const m = /@([^\s@]*)$/.exec(beforeCaret);
    if (m && refs.length > 0) {
      setMentionQuery(m[1]);
      setMentionOpen(true);
      setMentionPos(caretPosInEditor(editor, zoom));
    } else {
      setMentionOpen(false);
    }
  }, [onChange, refs.length, zoom]);

  // 在光标处内联插入图片引用 token（点击缩略图或 @ 选择共用）；序列化时仍是「图片N」。
  const insertRefToken = useCallback((ref: RefItem) => {
    const editor = promptEditorRef.current;
    if (!editor) return;
    editor.focus();
    const range = getRangeInEditor(editor, promptRangeRef.current);
    range.deleteContents();
    const beforeCaret = textBeforePromptCaret(editor);
    const mention = /@([^\s@]*)$/.exec(beforeCaret);
    if (mention && range.startContainer.nodeType === Node.TEXT_NODE) {
      const textNode = range.startContainer as Text;
      const start = Math.max(0, range.startOffset - mention[0].length);
      textNode.deleteData(start, range.startOffset - start);
      range.setStart(textNode, start);
      range.collapse(true);
    }
    const tokenEl = createPromptRefElement(ref);
    // 零宽空格作为 token 后的光标落点（U+200B），用 fromCharCode 避免源码出现不可见字符
    const caretText = document.createTextNode(String.fromCharCode(0x200b));
    range.insertNode(tokenEl);
    tokenEl.after(caretText);
    placeCaretInsideText(caretText, caretText.length);
    updatePromptFromEditor();
    setMentionOpen(false);
    setMentionQuery("");
  }, [updatePromptFromEditor]);

  const selectMention = (id: string) => {
    const ref = refs.find((r) => r.id === id);
    if (ref) insertRefToken(ref);
  };

  const handlePromptKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // @ 引用下拉打开时：Esc 关闭，Enter 选中第一个候选
    if (mentionOpen) {
      if (e.key === "Escape") {
        setMentionOpen(false);
      } else if (e.key === "Enter" && mentionList.length > 0) {
        e.preventDefault();
        selectMention(mentionList[0].id);
      }
      return;
    }
    // 回车发送 / Shift+回车换行；中文输入法组合输入时（isComposing）回车确认候选词，不触发发送
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSubmit?.();
    }
  };

  // 外部 value/refs 变化且未聚焦时，重渲染编辑器 DOM（让「图片N」显示为内联 pill）
  useEffect(() => {
    const editor = promptEditorRef.current;
    if (!editor) return;
    if (document.activeElement === editor) return;
    syncPromptEditorContent(editor, value || "", refs);
  }, [value, refs]);

  // 鼠标在输入框上滚动时，若内容可滚则滚输入框、不冒泡到画布（画布的 wheel 会平移并 preventDefault 掉默认滚动）。
  // 画布用的是原生冒泡 wheel 监听、先于 React onWheel，故必须在源头用原生 listener stopPropagation。
  useEffect(() => {
    const editor = promptEditorRef.current;
    if (!editor) return;
    const onWheel = (e: WheelEvent) => {
      if (editor.scrollHeight > editor.clientHeight) e.stopPropagation();
    };
    editor.addEventListener("wheel", onWheel, { passive: true });
    return () => editor.removeEventListener("wheel", onWheel);
  }, []);

  const editorStyleBase = {
    cursor: "text",
    outline: "none",
    boxShadow: "none",
    overflowX: "hidden" as const,
    wordBreak: "break-word" as const,
    overflowWrap: "anywhere" as const,
    boxSizing: "border-box" as const,
  };

  return (
    <>
      {/* 缩略图行：节点专属按钮 + 可引用图片缩略图 */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {leading}
          {refs.map((ref) => (
            <ReferenceThumb
              key={ref.id}
              refItem={ref}
              active={promptHasRef(ref.index)}
              onPick={(e) => { stop(e); insertRefToken(ref); }}
            />
          ))}
        </div>
        {trailing}
      </div>

      {/* 富文本编辑器 + @ 下拉 */}
      <div className={`relative mt-3 ${fill ? "flex min-h-0 flex-1 flex-col" : ""}`}>
        {!value && (
          <span className="pointer-events-none absolute left-0 top-0 text-sm leading-6 text-neutral-400">
            {placeholder}
          </span>
        )}
        <div
          ref={promptEditorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={updatePromptFromEditor}
          onKeyDown={handlePromptKeyDown}
          onMouseDown={stop}
          onMouseUp={() => {
            const selection = window.getSelection();
            if (selection?.rangeCount) promptRangeRef.current = selection.getRangeAt(0).cloneRange();
          }}
          onKeyUp={() => {
            const selection = window.getSelection();
            if (selection?.rangeCount) promptRangeRef.current = selection.getRangeAt(0).cloneRange();
          }}
          onFocus={() => {
            const editor = promptEditorRef.current;
            if (editor && !editor.textContent && !editor.childNodes.length) {
              syncPromptEditorContent(editor, value || "", refs);
            }
          }}
          onBlur={() => {
            const editor = promptEditorRef.current;
            if (editor) {
              const prompt = serializePromptEditor(editor);
              onChange(prompt);
              syncPromptEditorContent(editor, prompt, refs);
            }
            promptRangeRef.current = null;
            setMentionOpen(false);
          }}
          spellCheck={false}
          className="relative block w-full overflow-y-auto whitespace-pre-wrap break-words border-0 bg-transparent text-sm leading-6 text-neutral-900 caret-neutral-900 selection:bg-blue-200/60 focus:outline-none focus-visible:outline-none focus:ring-0 dark:text-neutral-100 dark:caret-neutral-100 dark:selection:bg-blue-500/40"
          style={fill ? { ...editorStyleBase, minHeight: 0, flex: 1 } : { ...editorStyleBase, minHeight: `${MIN_ROWS * LINE_HEIGHT}px`, maxHeight: `${MAX_ROWS * LINE_HEIGHT}px` }}
        />

        {/* @ 引用下拉：锚定到 @ 光标正下方 */}
        {mentionOpen && mentionList.length > 0 && mentionPos && (
          <div
            className="absolute z-30 max-h-48 w-56 overflow-auto rounded-xl border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
            style={{ left: mentionPos.left, top: mentionPos.top + 4 }}
          >
            {mentionList.map((ref) => (
              <button
                key={ref.id}
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); selectMention(ref.id); }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                {ref.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ref.thumb} alt="" className="h-6 w-6 rounded object-cover" />
                ) : (
                  <span className="flex h-6 w-6 items-center justify-center rounded bg-neutral-100 text-[9px] text-neutral-400 dark:bg-neutral-800">图</span>
                )}
                <span className="text-sm text-neutral-700 dark:text-neutral-200">图片{ref.index}</span>
                <span className="ml-auto text-xs text-neutral-400">@{ref.index}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/**
 * 提示词放大编辑弹层：点输入框右上「展开」按钮打开，居中大编辑区，方便查看/编辑长 prompt。
 * 复用 PromptRefEditor（@ 引用、内联 pill 与节点内一致）；Portal 到 body、脱离画布缩放（zoom=1）。
 * 与节点内编辑器共享 node.prompt：弹层里改动实时写回，关闭后节点内同步显示。
 */
export function PromptEditorModal({
  open,
  onClose,
  value,
  onChange,
  refs,
  placeholder,
}: {
  open: boolean;
  onClose: () => void;
  value: string;
  onChange: (value: string) => void;
  refs: RefItem[];
  placeholder?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-6 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        className="flex w-[680px] max-w-[92vw] flex-col rounded-2xl border border-neutral-200 bg-white p-4 shadow-2xl dark:border-neutral-800 dark:bg-neutral-900"
        style={{ height: 520, maxHeight: "85vh" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-medium text-neutral-700 dark:text-neutral-200">编辑提示词</span>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          <PromptRefEditor fill value={value} onChange={onChange} refs={refs} zoom={1} placeholder={placeholder} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
