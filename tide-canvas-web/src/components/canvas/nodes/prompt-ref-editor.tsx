"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import {
  type RefItem,
  type CaretAnchor,
  ReferenceThumb,
  refLabel,
  refCaption,
  refGlyph,
  resolvePastedRefTokens,
  buildPromptNodes,
  LINE_HEIGHT,
  MIN_ROWS,
  MAX_ROWS,
  AT_QUERY_RE,
  MENTION_MENU_W,
  ZERO_WIDTH_SPACE,
  normalizePromptForCompare,
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
  placeholder?: string;
  /** contentEditable 的无障碍名称；未传时由具体节点周边可见标签提供上下文。 */
  ariaLabel?: string;
  /** 回车（非换行、非输入法组合、@ 下拉未开）触发 */
  onSubmit?: () => void;
  /** true=flex-1 填充剩余空间（视频节点）；false=按 MIN/MAX_ROWS 固定高（图片节点） */
  fill?: boolean;
  /** 是否渲染缩略图行（含 leading/trailing）。助手面板自带附件卡片，传 false */
  showThumbs?: boolean;
  /** 编辑器 className 覆盖（助手面板要贴合自己的 composer 排版） */
  editorClassName?: string;
  /** 编辑器内联样式覆盖（合并在默认高度约束之上，如助手面板的放大/收起两档高度） */
  editorStyle?: React.CSSProperties;
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
export function PromptRefEditor({
  value, onChange, refs, placeholder, ariaLabel, onSubmit,
  fill = false, showThumbs = true, editorClassName, editorStyle, leading, trailing,
}: Props) {
  const promptEditorRef = useRef<HTMLDivElement>(null);
  const promptRangeRef = useRef<Range | null>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  // @ 浮层锚点：光标相对输入框容器的局部坐标（缩放由 caretPosInEditor 实测）
  const [mentionPos, setMentionPos] = useState<CaretAnchor | null>(null);
  // 键盘导航高亮项；候选集变化时归零，避免停在已消失的下标上
  const [mentionIndex, setMentionIndex] = useState(0);
  const activeItemRef = useRef<HTMLButtonElement>(null);
  const mentionMenuRef = useRef<HTMLDivElement>(null);
  // 组字态：IME 组字期间外部写入绝不能重建 DOM（会打断输入法）。
  // document.activeElement 在 IME 下会瞬时漂移，所以用事件记而不是查 DOM。
  const composingRef = useRef(false);
  const compositionCommitFrameRef = useRef<number | null>(null);

  // 引用以 prompt 文本为唯一数据源：该 token 是否已存在（N 后不接数字，避免
  // 「图片1」误命中「图片12」）。label 只含中文与数字，直接拼进正则是安全的。
  const promptHasRef = useCallback(
    (ref: RefItem) => new RegExp(`${refLabel(ref)}(?!\\d)`).test(value || ""),
    [value]
  );
  // 查询串同时匹配序号标签「图片1」与素材名（缩略图下方显示的文件名）——用户记得住的
  // 是文件名，只按标签过滤的话「@角色三视图」会筛空、菜单直接不弹。
  const mentionList = useMemo(
    () => refs.filter((r) => {
      if (promptHasRef(r)) return false;
      if (!mentionQuery) return true;
      const q = mentionQuery.toLowerCase();
      return refLabel(r).toLowerCase().includes(q) || refCaption(r).toLowerCase().includes(q) || String(r.index) === mentionQuery;
    }),
    [refs, promptHasRef, mentionQuery]
  );

  // ↑/↓ 高亮行保持可见：菜单 max-h-48 只容 ~5 行，候选更多时会滚动，
  // 否则 Enter 插入的是用户看不见的那一条。
  //
  // 只滚菜单自身，不用 scrollIntoView——后者会一路上滚**每一个**可滚动祖先，
  // 最终推动画布根那个 overflow:hidden 容器（节点靠边时菜单会溢出到视口外，
  // 正好给它制造出可滚区）。画布的 pan/zoom 只写 transform、从不读 scrollLeft，
  // 又没有滚动条，被推偏后整个会话都回不来。
  // 用 offsetTop/offsetHeight 而非 getBoundingClientRect：布局坐标不受画布
  // 缩放影响，与 scrollTop/clientHeight 同一坐标系（菜单是 absolute，正是
  // 各行 <button> 的 offsetParent）。
  useEffect(() => {
    const menu = mentionMenuRef.current;
    const item = activeItemRef.current;
    if (!mentionOpen || !menu || !item) return;
    const top = item.offsetTop;
    const bottom = top + item.offsetHeight;
    if (top < menu.scrollTop) menu.scrollTop = top;
    else if (bottom > menu.scrollTop + menu.clientHeight) menu.scrollTop = bottom - menu.clientHeight;
  }, [mentionIndex, mentionOpen]);

  // 按当前光标位置重测 @ 查询（开/关菜单、更新锚点）。输入与光标移动共用。
  // keepZwsp：pill 后的零宽空格要保留，AT_QUERY_RE 靠它认「pill 紧跟的 @」
  const syncMentionFromCaret = useCallback(() => {
    const editor = promptEditorRef.current;
    if (!editor) return;
    // 非折叠选区（拖选 / 双击 / Shift+方向键）不是「在光标处打 @」：
    // textBeforePromptCaret 读的是选区**末端**，会把选中的 @xx 误判成查询串，
    // 菜单弹出后 Enter 会走 insertRefToken 的 range.deleteContents()，
    // 把用户选中的文字直接删掉换成 pill（且不触发提交）。
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      setMentionOpen(false);
      return;
    }
    const m = refs.length > 0 ? AT_QUERY_RE.exec(textBeforePromptCaret(editor, true)) : null;
    if (m) {
      setMentionQuery(m[2]);
      setMentionOpen(true);
      setMentionIndex(0);
      setMentionPos(caretPosInEditor(editor));
    } else {
      setMentionOpen(false);
    }
  }, [refs.length]);

  const updatePromptFromEditor = useCallback(() => {
    const editor = promptEditorRef.current;
    if (!editor) return;
    const selection = window.getSelection();
    if (selection?.rangeCount && editor.contains(selection.getRangeAt(0).commonAncestorContainer)) {
      promptRangeRef.current = selection.getRangeAt(0).cloneRange();
    }
    onChange(serializePromptEditor(editor));
    syncMentionFromCaret();
  }, [onChange, syncMentionFromCaret]);

  const handlePromptInput = useCallback((event: React.FormEvent<HTMLDivElement>): void => {
    // 中文、日文等输入法会连续派发携带中间候选文本的 input。中间态不能写入
    // 外部 store，否则 React 回写 value 时会用旧候选覆盖浏览器刚提交的最终文字。
    if (composingRef.current || (event.nativeEvent as InputEvent).isComposing) return;
    updatePromptFromEditor();
  }, [updatePromptFromEditor]);

  const handleCompositionStart = useCallback((): void => {
    composingRef.current = true;
    if (compositionCommitFrameRef.current !== null) {
      window.cancelAnimationFrame(compositionCommitFrameRef.current);
      compositionCommitFrameRef.current = null;
    }
  }, []);

  const handleCompositionEnd = useCallback((): void => {
    // Safari、Firefox 与 Chromium 对 compositionend / 最后一次 input 的先后顺序
    // 不完全一致。延迟到下一帧统一读取最终 DOM，并在此之前继续阻止 value 回写。
    if (compositionCommitFrameRef.current !== null) {
      window.cancelAnimationFrame(compositionCommitFrameRef.current);
    }
    compositionCommitFrameRef.current = window.requestAnimationFrame(() => {
      compositionCommitFrameRef.current = null;
      composingRef.current = false;
      updatePromptFromEditor();
    });
  }, [updatePromptFromEditor]);

  useEffect(() => () => {
    if (compositionCommitFrameRef.current !== null) {
      window.cancelAnimationFrame(compositionCommitFrameRef.current);
    }
  }, []);

  // 在光标处内联插入图片引用 token（点击缩略图或 @ 选择共用）；序列化时仍是「图片N」。
  const insertRefToken = useCallback((ref: RefItem) => {
    const editor = promptEditorRef.current;
    if (!editor) return;
    // preventScroll 必须给：不加的话 Blink 会在聚焦时 RevealSelection，一路上滚
    // 每一个可滚动祖先——包括画布根那个 overflow:hidden 容器。与刚去掉的
    // scrollIntoView 是同一个病，只是换了触发点：节点靠边时点缩略图就会把整个
    // 世界层推偏，且没有滚动条可还原。
    editor.focus({ preventScroll: true });
    const range = getRangeInEditor(editor, promptRangeRef.current);
    range.deleteContents();
    const mention = AT_QUERY_RE.exec(textBeforePromptCaret(editor, true));
    if (mention && range.startContainer.nodeType === Node.TEXT_NODE) {
      // 只吃掉「@ + 查询串」；mention[1] 是边界字符（前一个字/零宽空格），保留。
      // 查询串可能跨文本节点（键入 @ 后粘贴会切出新节点），向前逐节点删，
      // 遇到非文本边界（pill / br）防御性停删。
      let remaining = 1 + mention[2].length;
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
    const tokenEl = createPromptRefElement(ref);
    // 零宽空格：光标落点 + @ 触发边界，与 syncPromptEditorContent 的重建路径同形
    const caretText = document.createTextNode(ZERO_WIDTH_SPACE);
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

  // 粘贴：先把「@文件名」改写成规范 token「图片N」，再按 token 建 pill 一次性插入。
  // 从别处抄来的提示词里写的是人看得懂的名字，靠 @ 下拉逐个重选既繁琐又容易漏。
  const insertPastedText = useCallback((raw: string) => {
    const editor = promptEditorRef.current;
    if (!editor) return;
    const text = resolvePastedRefTokens(raw, refs);
    const nodes = buildPromptNodes(text, refs);
    // 不含可绑定引用时走 execCommand：手工改 DOM 会打断浏览器原生撤销栈，
    // 而绝大多数粘贴都是纯文本，不该为这条罕见路径整体牺牲 Ctrl+Z。
    if (nodes.length <= 1) {
      if (text) document.execCommand("insertText", false, text);
      return;
    }
    editor.focus({ preventScroll: true });
    const range = getRangeInEditor(editor, promptRangeRef.current);
    range.deleteContents();
    const tail = nodes[nodes.length - 1];
    const fragment = document.createDocumentFragment();
    fragment.append(...nodes);
    range.insertNode(fragment);
    // 光标落到粘贴内容末尾。以 pill 收尾时 buildPromptNodes 已补零宽空格文本节点，
    // 落不进 pill 内部；tail 非文本节点只可能是防御性分支。
    if (tail.nodeType === Node.TEXT_NODE) {
      placeCaretInsideText(tail as Text, (tail.textContent || "").length);
    } else {
      const caretText = document.createTextNode(ZERO_WIDTH_SPACE);
      tail.after(caretText);
      placeCaretInsideText(caretText, caretText.length);
    }
  }, [refs]);

  const handlePromptKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // 消费端兜底：选区非折叠时菜单一律不生效。
    // syncMentionFromCaret 里的同名守卫只覆盖 onInput / onMouseUp / 过滤后的
    // onKeyUp 三条路径，而 Ctrl+A、以及「按住拖选到编辑器外再松手」（鼠标无隐式
    // 捕获，mouseup 落在画布上）都绕得过去——菜单会停在旧锚点继续显示。此时按
    // Enter 会走 selectMention → insertRefToken 的 range.deleteContents()，
    // 把用户选中的整段文字删掉换成一个 pill，且 onSubmit 根本不触发。
    const selection = window.getSelection();
    const collapsed = !selection || selection.isCollapsed;
    if (mentionOpen && !collapsed) setMentionOpen(false);

    // @ 引用下拉打开时接管方向键与确认键（与创作台 MentionPromptEditor 一致）。
    // 条件必须与下方菜单的渲染条件完全一致（含 mentionPos）：锚点计算失败时菜单
    // 并未渲染，不能让 Enter 隔空选中一个用户看不见的候选。
    if (collapsed && mentionOpen && mentionList.length > 0 && mentionPos) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionList.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + mentionList.length) % mentionList.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        selectMention(mentionList[Math.min(mentionIndex, mentionList.length - 1)].id);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        // 菜单可见时 Esc 只关菜单：必须掐断**原生**冒泡。React 把 keydown 委托到
        // portal 容器 document.body，仍在 window 之下，而 PromptEditorModal 的
        // window 监听不查 defaultPrevented——只 preventDefault 的话，放大弹层会
        // 被同一次 Esc 一起关掉。
        e.stopPropagation();
        setMentionOpen(false);
        return;
      }
      return;
    }
    // 兜底：mentionOpen 为真但菜单没渲染（无候选/锚点失败）。这里**不**掐冒泡——
    // 用户看不见菜单，Esc 理应继续传给放大弹层去关闭它，否则第一次按 Esc 像失灵。
    if (collapsed && mentionOpen && e.key === "Escape") {
      setMentionOpen(false);
      return;
    }
    // 回车发送 / Shift+回车换行；中文输入法组合输入时（isComposing）回车确认候选词，不触发发送
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSubmit?.();
    }
  };

  // 外部 value/refs 变化时重渲染编辑器 DOM（让「图片N」显示为内联 pill）。
  //
  // 聚焦时**不能**无条件跳过：本组件是非受控的 contentEditable，调用方
  // setValue("") 并不会清空 DOM。助手面板回车发送后正是这个情形——已发送的文字
  // 留在框里（占位符还叠在上面），下次输入 onInput 会把它一起序列化再发一遍，
  // 并二次扣费。鼠标点发送因为焦点先移走反而正常，两条路径行为分叉。
  //
  // 判据是「DOM 序列化 ≈ value」：自己敲出来的变化两者代表同一份内容（onInput 刚把
  // 序列化结果写进 value），不等即外部改写，此时才重建。组字期间一律不动 DOM，
  // 否则会打断输入法。
  // 比较必须走 normalizePromptForCompare 而不是全等：value 未必是 serialize∘sync
  // 的不动点（NBSP 会被换成空格、画布 store 还会解码 \uXXXX），直接比会把这些
  // 无害差异误判成外部改写，用户在句中打字时光标被反复甩到末尾。
  useEffect(() => {
    const editor = promptEditorRef.current;
    if (!editor) return;
    const next = value || "";
    if (document.activeElement !== editor) {
      syncPromptEditorContent(editor, next, refs);
      return;
    }
    if (composingRef.current) return;
    if (normalizePromptForCompare(serializePromptEditor(editor)) === normalizePromptForCompare(next)) return;
    syncPromptEditorContent(editor, next, refs);
    // 旧 Range 指向已被 replaceChildren 摘掉的节点，必须作废；光标收到末尾。
    promptRangeRef.current = null;
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
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

  // 菜单是编辑器的**兄弟**节点，不在上面那个 listener 的传播路径上：候选超过 5 条
  // 需要滚动时，滚轮会一路冒泡到画布，结果是整个画布平移、菜单跟着节点滑走。
  // 菜单条件渲染，所以 effect 要挂在可见性上，挂载时才能拿到 ref 完成绑定。
  const mentionMenuVisible = mentionOpen && mentionList.length > 0 && !!mentionPos;
  useEffect(() => {
    const menu = mentionMenuRef.current;
    if (!menu) return;
    const onWheel = (e: WheelEvent) => {
      if (menu.scrollHeight > menu.clientHeight) e.stopPropagation();
    };
    menu.addEventListener("wheel", onWheel, { passive: true });
    return () => menu.removeEventListener("wheel", onWheel);
  }, [mentionMenuVisible]);

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
      {/* 缩略图行：节点专属按钮 + 可引用素材缩略图。
          助手面板传 showThumbs={false}——它的附件区已有带序号的卡片，
          再来一行缩略图是重复信息。 */}
      {showThumbs && (
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {leading}
            {refs.map((ref) => (
              <ReferenceThumb
                key={ref.id}
                refItem={ref}
                active={promptHasRef(ref)}
                onPick={(e) => { stop(e); insertRefToken(ref); }}
              />
            ))}
          </div>
          {trailing}
        </div>
      )}

      {/* 富文本编辑器 + @ 下拉 */}
      {/* mt-3 只是与上方缩略图行的间距——助手面板不渲染那行，也就不要这段留白 */}
      <div className={`relative ${showThumbs ? "mt-3" : ""} ${fill ? "flex min-h-0 flex-1 flex-col" : ""}`}>
        {!value && (
          <span className="pointer-events-none absolute left-0 top-0 text-sm leading-6 text-neutral-500 dark:text-neutral-400">
            {placeholder}
          </span>
        )}
        <div
          ref={promptEditorRef}
          contentEditable
          role="textbox"
          aria-label={ariaLabel}
          aria-multiline="true"
          suppressContentEditableWarning
          onInput={handlePromptInput}
          onKeyDown={handlePromptKeyDown}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          onPaste={(e) => {
            // 富文本粘贴降级为纯文本：外部 HTML 会把 <p>/<div>/<span style> 结构
            // 连同 font-size / white-space 一起注进编辑器（14px 的框里冒出 16px
            // 文字、pre-wrap 失效），块级结构也要靠序列化器兜换行。这里从源头掐掉。
            e.preventDefault();
            const text = e.clipboardData?.getData("text/plain") ?? "";
            // \r\n 归一化：Windows 剪贴板是 CRLF，\r 混进 value 会污染下发的 prompt
            if (text) insertPastedText(text.replace(/\r\n?/g, "\n"));
            updatePromptFromEditor();
          }}
          onMouseDown={stop}
          onMouseUp={() => {
            const selection = window.getSelection();
            if (selection?.rangeCount) promptRangeRef.current = selection.getRangeAt(0).cloneRange();
            syncMentionFromCaret();
          }}
          onKeyUp={(e) => {
            const selection = window.getSelection();
            if (selection?.rangeCount) promptRangeRef.current = selection.getRangeAt(0).cloneRange();
            // 光标移动后重测 @ 查询：否则「菜单还开着、光标已移走」时 keydown 会
            // 继续吞掉 ↑/↓（无法移动光标）。组字中不动菜单。
            // ↑/↓ 仅在菜单未开时才算移动光标——菜单开着时它们是候选导航,
            // keydown 已消费，这里再重测会把高亮行冲回第一行。
            if (e.nativeEvent.isComposing) return;
            const k = e.key;
            if (
              k === "ArrowLeft" || k === "ArrowRight" || k === "Home" || k === "End" ||
              k === "PageUp" || k === "PageDown" ||
              (!mentionOpen && (k === "ArrowUp" || k === "ArrowDown"))
            ) {
              syncMentionFromCaret();
            }
          }}
          onFocus={() => {
            const editor = promptEditorRef.current;
            if (editor && !editor.textContent && !editor.childNodes.length) {
              syncPromptEditorContent(editor, value || "", refs);
            }
          }}
          onBlur={() => {
            if (compositionCommitFrameRef.current !== null) {
              window.cancelAnimationFrame(compositionCommitFrameRef.current);
              compositionCommitFrameRef.current = null;
            }
            composingRef.current = false;
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
          className={`nodrag nopan ${editorClassName ?? "prompt-scroll relative block w-full overflow-y-auto whitespace-pre-wrap break-words border-0 bg-transparent pr-2 text-sm leading-6 text-neutral-900 caret-neutral-900 selection:bg-blue-200/60 focus:outline-none focus-visible:outline-none focus:ring-0 dark:text-neutral-100 dark:caret-neutral-100 dark:selection:bg-blue-500/40"}`}
          style={{
            ...(fill
              ? { ...editorStyleBase, minHeight: 0, flex: 1 }
              : { ...editorStyleBase, minHeight: `${MIN_ROWS * LINE_HEIGHT}px`, maxHeight: `${MAX_ROWS * LINE_HEIGHT}px` }),
            ...editorStyle,
          }}
        />

        {/* @ 引用下拉：锚定到 @ 光标正下方 */}
        {mentionOpen && mentionList.length > 0 && mentionPos && (
          <div
            ref={mentionMenuRef}
            className="prompt-scroll absolute z-30 max-h-48 overflow-auto rounded-xl border border-neutral-200 bg-white p-1 shadow-[0_16px_40px_rgba(15,23,42,0.16)] dark:border-white/12 dark:bg-[#1c1c20] dark:shadow-black/35"
            style={{
              left: mentionPos.left,
              width: MENTION_MENU_W,
              // 视口下方放不下时翻到光标上方（节点面板常贴屏幕底部）
              ...(mentionPos.flip
                ? { bottom: mentionPos.bottom + 4 }
                : { top: mentionPos.top + 4 }),
            }}
          >
            {mentionList.map((ref, i) => (
              <button
                key={ref.id}
                type="button"
                ref={i === Math.min(mentionIndex, mentionList.length - 1) ? activeItemRef : null}
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); selectMention(ref.id); }}
                onMouseEnter={() => setMentionIndex(i)}
                className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                  i === Math.min(mentionIndex, mentionList.length - 1)
                    ? "bg-neutral-100 dark:bg-neutral-800"
                    : "hover:bg-neutral-100 dark:hover:bg-neutral-800"
                }`}
              >
                {ref.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ref.thumb} alt="" className="h-6 w-6 rounded object-cover" />
                ) : (
                  <span className="flex h-6 w-6 items-center justify-center rounded bg-neutral-100 text-[10px] text-neutral-400 dark:bg-neutral-800">{refGlyph(ref)}</span>
                )}
                {/* 主文本是素材名（认得出选的是哪张），右侧标注实际插入的 token；
                    未命名素材两者相同，此时不重复显示 */}
                <span className="min-w-0 flex-1 truncate text-sm text-neutral-700 dark:text-neutral-200">{refCaption(ref)}</span>
                {refCaption(ref) !== refLabel(ref) && (
                  <span className="shrink-0 text-xs text-neutral-400">{refLabel(ref)}</span>
                )}
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
 * 复用 PromptRefEditor（@ 引用、内联 pill 与节点内一致）；Portal 到 body、脱离画布缩放
 * （锚点缩放由 caretPosInEditor 从元素实测，此处天然为 1，无需显式传参）。
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
          <PromptRefEditor fill value={value} onChange={onChange} refs={refs} placeholder={placeholder} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
