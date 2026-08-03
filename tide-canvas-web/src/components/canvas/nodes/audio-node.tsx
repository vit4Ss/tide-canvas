"use client";

import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useCanvasStore } from "@/stores/use-canvas-store";
import {
  AudioLines,
  ChevronDown,
  Loader2,
  Mic2,
  Music2,
  SlidersHorizontal,
  Zap,
} from "lucide-react";
import {
  AUDIO_STYLES,
  DEFAULT_MUSIC_PARAMS,
  MUSIC_MODES,
  buildMusicInput,
  clipDisplayLabel,
  fetchClipOptions,
  isSfxModel,
  validateMusicParams,
  findClipModel,
  uploadCostOf,
  type ClipOption,
  type MusicParams,
} from "@/lib/music-modes";
import { AiModelType, type AiModelVO } from "@/types/ai";
import { toast } from "@/components/shared/toast";
import { NodeHeader } from "./base/node-header";
import { NodePorts } from "./base/node-ports";
import { ModelPicker } from "./model-picker";
import { ClipPicker } from "@/components/studio/clip-picker";
import type { CanvasNodeProps } from "./types/node-props";
import { useAiModels, useNodeRuntime } from "./shared/use-node-runtime";
import { parseModelConfig, stopEvent as stop } from "./shared/node-utils";
import { GenerateSubmitButton, NodePanelChrome, NodeShell } from "./shared/node-overlays";
import { CanvasSkillRunNodeShortcut } from "../skill-run/canvas-skill-run-workspace";

const MAX_TEXT = 50000;
const WAVE_BARS = [16, 28, 44, 60, 40, 24, 34, 54, 70, 48, 30, 18, 42, 56, 36, 22];
const PAUSE_OPTIONS = [
  { label: "0.25s", token: "<#0.25#>" },
  { label: "0.5s", token: "<#0.5#>" },
  { label: "1.0s", token: "<#1.0#>" },
  { label: "1.5s", token: "<#1.5#>" },
];
const TONE_OPTIONS = [
  { label: "笑声", token: "(笑声)" },
  { label: "轻笑", token: "(轻笑)" },
  { label: "咳嗽", token: "(咳嗽)" },
  { label: "清嗓子", token: "(清嗓子)" },
  { label: "正常换气", token: "(正常换气)" },
  { label: "喘气", token: "(喘气)" },
  { label: "吸气", token: "(吸气)" },
  { label: "呼气", token: "(呼气)" },
  { label: "倒吸气", token: "(倒吸气)" },
  { label: "吸鼻子", token: "(吸鼻子)" },
  { label: "叹气", token: "(叹气)" },
  { label: "喷鼻息", token: "(喷鼻息)" },
  { label: "打嗝", token: "(打嗝)" },
  { label: "咂嘴", token: "(咂嘴)" },
  { label: "哼唱", token: "(哼唱)" },
  { label: "嘶嘶声", token: "(嘶嘶声)" },
  { label: "嗯", token: "(嗯)" },
  { label: "口哨", token: "(口哨)" },
  { label: "喷嚏", token: "(喷嚏)" },
  { label: "抽泣", token: "(抽泣)" },
  { label: "鼓掌", token: "(鼓掌)" },
];
type AudioTokenMenu = "pause" | "tone" | null;
const AUDIO_TOKEN_RE = /(<#(?:\d+(?:\.\d+)?)#>|&lt;#(?:\d+(?:\.\d+)?)#&gt;|\([^()\n]+\))/g;
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);

interface VoiceOption {
  id: string;
  name: string;
}

/** 模型配置里的生成方式（t2a=音乐 / sfx=音效；TTS 模型通常不配）。 */
function modesOf(model?: AiModelVO): string[] {
  const cfg = parseModelConfig<{ modes?: unknown }>(model);
  return Array.isArray(cfg.modes) ? cfg.modes.filter((m): m is string => typeof m === "string") : [];
}

function voicesOf(model?: AiModelVO): VoiceOption[] {
  const cfg = parseModelConfig<{ voices?: unknown }>(model);
  if (!Array.isArray(cfg.voices)) return [];
  return cfg.voices
    .filter((v): v is VoiceOption => !!v && typeof (v as VoiceOption).id === "string" && !!(v as VoiceOption).id)
    .map((v) => ({ id: v.id, name: v.name || v.id }));
}

function decodeUnicodeEscapes(value: string): string {
  if (!value.includes("\\u")) return value;
  let decoded = value;
  for (let i = 0; i < 3; i += 1) {
    const next = decoded.replace(/\\+u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}


interface AudioPromptEditorHandle {
  insertToken: (token: string) => string | undefined;
}

interface AudioPromptEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  expanded: boolean;
}

function normalizeAudioTokenText(tokenText: string) {
  return tokenText.replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function createAudioTokenElement(tokenText: string) {
  const normalizedToken = normalizeAudioTokenText(tokenText);
  const token = document.createElement("span");
  token.contentEditable = "false";
  token.dataset.audioToken = normalizedToken;
  token.textContent = normalizedToken;
  token.className =
    "mx-0.5 inline-flex h-[22px] items-center rounded-md bg-sky-50 px-1.5 align-middle text-xs font-semibold leading-none text-sky-600 ring-1 ring-sky-100 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900/60";
  return token;
}

function serializeAudioPromptNode(node: ChildNode): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent || "").split(ZERO_WIDTH_SPACE).join("");
  }
  if (!(node instanceof HTMLElement)) return "";
  if (node.dataset.audioToken) return node.dataset.audioToken;
  if (node.tagName === "BR") return "\n";
  return Array.from(node.childNodes).map(serializeAudioPromptNode).join("");
}

function serializeAudioPromptEditor(editor: HTMLDivElement) {
  return Array.from(editor.childNodes).map(serializeAudioPromptNode).join("");
}

function syncAudioPromptEditor(editor: HTMLDivElement, value: string) {
  const nodes: ChildNode[] = [];
  AUDIO_TOKEN_RE.lastIndex = 0;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = AUDIO_TOKEN_RE.exec(value)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(document.createTextNode(value.slice(lastIndex, match.index)));
    }
    nodes.push(createAudioTokenElement(normalizeAudioTokenText(match[0])));
    nodes.push(document.createTextNode(ZERO_WIDTH_SPACE));
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < value.length) nodes.push(document.createTextNode(value.slice(lastIndex)));
  editor.replaceChildren(...nodes);
}

function getAudioEditorRange(editor: HTMLDivElement, fallback?: Range | null) {
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

function placeCaretInText(node: Text, offset = node.length) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.setStart(node, Math.min(offset, node.length));
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function isAudioTokenNode(node: ChildNode | null): node is HTMLElement {
  return node instanceof HTMLElement && !!node.dataset.audioToken;
}

function removeAudioTokenNearCaret(editor: HTMLDivElement | null, direction: "backward" | "forward") {
  if (!editor) return false;
  const selection = window.getSelection();
  if (!selection?.rangeCount) return false;
  const range = selection.getRangeAt(0);
  if (!range.collapsed || !editor.contains(range.commonAncestorContainer)) return false;

  let token: HTMLElement | null = null;
  let spacer: Text | null = null;

  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    const textNode = range.startContainer as Text;
    if (direction === "backward") {
      const before = textNode.data.slice(0, range.startOffset);
      if (before === ZERO_WIDTH_SPACE && isAudioTokenNode(textNode.previousSibling)) {
        token = textNode.previousSibling;
        spacer = textNode;
      } else if (range.startOffset === 0 && isAudioTokenNode(textNode.previousSibling)) {
        token = textNode.previousSibling;
      }
    } else if (range.startOffset === textNode.length && isAudioTokenNode(textNode.nextSibling)) {
      token = textNode.nextSibling;
      const next = token.nextSibling;
      if (next?.nodeType === Node.TEXT_NODE && next.textContent === ZERO_WIDTH_SPACE) spacer = next as Text;
    }
  } else if (range.startContainer instanceof HTMLElement) {
    const children = Array.from(range.startContainer.childNodes);
    const maybeToken = direction === "backward" ? children[range.startOffset - 1] : children[range.startOffset];
    if (isAudioTokenNode(maybeToken)) token = maybeToken;
    const next = token?.nextSibling;
    if (next?.nodeType === Node.TEXT_NODE && next.textContent === ZERO_WIDTH_SPACE) spacer = next as Text;
  }

  if (!token) return false;
  const caretText = document.createTextNode("");
  token.before(caretText);
  spacer?.remove();
  token.remove();
  placeCaretInText(caretText, 0);
  return true;
}

const AudioPromptEditor = forwardRef<AudioPromptEditorHandle, AudioPromptEditorProps>(function AudioPromptEditor(
  { value, onChange, placeholder, expanded },
  ref,
) {
  const editorRef = useRef<HTMLDivElement>(null);
  const rangeRef = useRef<Range | null>(null);

  const updateFromEditor = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const selection = window.getSelection();
    if (selection?.rangeCount && editor.contains(selection.getRangeAt(0).commonAncestorContainer)) {
      rangeRef.current = selection.getRangeAt(0).cloneRange();
    }
    onChange(serializeAudioPromptEditor(editor));
  }, [onChange]);

  useImperativeHandle(ref, () => ({
    insertToken(tokenText: string) {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();
      const range = getAudioEditorRange(editor, rangeRef.current);
      range.deleteContents();
      const tokenEl = createAudioTokenElement(tokenText);
      const caretText = document.createTextNode(ZERO_WIDTH_SPACE);
      range.insertNode(caretText);
      range.insertNode(tokenEl);
      placeCaretInText(caretText, caretText.length);
      const next = serializeAudioPromptEditor(editor);
      onChange(next);
      return next;
    },
  }), [onChange]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || document.activeElement === editor) return;
    syncAudioPromptEditor(editor, value || "");
  }, [value]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const onWheel = (e: WheelEvent) => {
      if (editor.scrollHeight > editor.clientHeight) e.stopPropagation();
    };
    editor.addEventListener("wheel", onWheel, { passive: true });
    return () => editor.removeEventListener("wheel", onWheel);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Backspace" && removeAudioTokenNearCaret(editorRef.current, "backward")) {
      e.preventDefault();
      updateFromEditor();
    } else if (e.key === "Delete" && removeAudioTokenNearCaret(editorRef.current, "forward")) {
      e.preventDefault();
      updateFromEditor();
    }
  };

  return (
    <div className="relative px-2 pt-1">
      {!value && (
        <span className="pointer-events-none absolute left-2 top-1 text-sm leading-5 text-neutral-400">
          {placeholder}
        </span>
      )}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        onInput={updateFromEditor}
        onKeyDown={handleKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
        onMouseUp={() => {
          const selection = window.getSelection();
          if (selection?.rangeCount) rangeRef.current = selection.getRangeAt(0).cloneRange();
        }}
        onKeyUp={() => {
          const selection = window.getSelection();
          if (selection?.rangeCount) rangeRef.current = selection.getRangeAt(0).cloneRange();
        }}
        onBlur={() => {
          const editor = editorRef.current;
          if (!editor) return;
          const next = serializeAudioPromptEditor(editor);
          onChange(next);
          syncAudioPromptEditor(editor, next);
          rangeRef.current = null;
        }}
        className="block w-full overflow-y-auto whitespace-pre-wrap break-words border-none bg-transparent text-sm leading-5 text-neutral-900 outline-none caret-neutral-900 selection:bg-blue-200/60 focus:border-transparent focus:outline-none focus-visible:outline-none focus:ring-0 dark:text-neutral-100 dark:caret-neutral-100 dark:selection:bg-blue-500/40"
        style={{
          cursor: "text",
          minHeight: expanded ? 120 : 72,
          maxHeight: expanded ? 220 : 92,
          overflowX: "hidden",
          wordBreak: "break-word",
          overflowWrap: "anywhere",
          boxSizing: "border-box",
          border: "0",
          outline: "none",
          boxShadow: "none",
        }}
      />
    </div>
  );
});

export const AudioNode = memo(function AudioNode({
  node,
  isSelected,
  isDragging = false,
  isConnectTarget = false,
  onNodeMouseDown,
  onPortMouseDown,
}: CanvasNodeProps) {
  const updateNode = useCanvasStore((s) => s.updateNode);
  const { generate, generating, showAuxUI } = useNodeRuntime(node, isSelected, isDragging);
  const { models, modelId, setModelId, selectedModel } = useAiModels(AiModelType.AUDIO);

  const [voice, setVoice] = useState("");
  const [activeTokenMenu, setActiveTokenMenu] = useState<AudioTokenMenu>(null);
  const [customPauseValue, setCustomPauseValue] = useState("2.0");
  const promptEditorRef = useRef<AudioPromptEditorHandle>(null);
  // 音乐四创作模式（Suno 模型时生效）——字段与请求口径对齐创作台。
  const [music, setMusic] = useState<MusicParams>(DEFAULT_MUSIC_PARAMS);
  // 延长/翻唱的原曲候选（生成历史分轨）；null = 尚未拉取。
  const [clipOpts, setClipOpts] = useState<ClipOption[] | null>(null);
  // 原曲选择弹窗(替代下拉:Suno 同批两首同名,弹窗里能试听/看第 N 首区分)
  const [clipPickerOpen, setClipPickerOpen] = useState(false);
  // 分轨播放：Suno 一次两首，节点内切换（0 = 主歌）。
  const [trackIdx, setTrackIdx] = useState(0);

  const voices = voicesOf(selectedModel);
  const [lastModelId, setLastModelId] = useState(modelId);
  if (modelId !== lastModelId) {
    setLastModelId(modelId);
    setVoice(voices[0]?.id ?? "");
  }

  // 音频模型分流（与创作台一致）：sfx = 音效（只吃描述）；音乐 = 后台生成方式勾
  // t2a 或 modelKey 命中 suno；其余按 TTS（音色 + 停顿/语气词 token）。
  const modelModes = modesOf(selectedModel);
  const isSfx = isSfxModel(selectedModel?.modelId, modelModes);
  const isMusic =
    !isSfx &&
    (modelModes.includes("t2a") || /suno/i.test(`${selectedModel?.modelId ?? ""} ${selectedModel?.name ?? ""}`));
  const musicMode = music.musicMode;

  // 每次进入延长/翻唱都重拉原曲候选（新生成的歌完成后，重新切入即可看到）；
  // 已有列表在刷新期间保留展示，仅首次为 null 时显示加载态。
  useEffect(() => {
    if (!isMusic || (musicMode !== "extend" && musicMode !== "cover")) return;
    let alive = true;
    fetchClipOptions().then((opts) => {
      if (alive) setClipOpts(opts);
    });
    return () => {
      alive = false;
    };
  }, [isMusic, musicMode]);

  const clipLabel = clipDisplayLabel(clipOpts, music.sourceClipId);

  const handlePickClip = useCallback((opt: ClipOption) => {
    // 上传登记的原曲延长时须发 upload_extend,来源标记随选中项走
    setMusic((m) => ({ ...m, sourceClipId: opt.clipId, sourceIsUpload: !!opt.isUpload }));
    setClipPickerOpen(false);
    // 刚登记完成的上传原曲不在已拉取的候选里,插到最前,否则回显成「历史原曲」
    setClipOpts((prev) => (prev?.some((o) => o.clipId === opt.clipId) ? prev : [opt, ...(prev ?? [])]));
    // 上游把延长/翻唱任务钉到原曲的模型路由,选定原曲后自动切回原曲那张模型卡
    const src = findClipModel(models, opt);
    if (src && src.modelId !== modelId) {
      setModelId(src.modelId);
      toast.info(`已切换到原曲模型「${src.name}」`);
    } else if (!src && (opt.modelId || opt.modelName)) {
      toast.info("原曲所用模型已下架，续写/翻唱可能失败");
    }
  }, [models, modelId, setModelId]);

  const effectiveVoice = voice || voices[0]?.id || "";
  const cost = Math.ceil(Number(selectedModel?.pointCost ?? 10));
  const rawPrompt = node.prompt || "";
  const prompt = decodeUnicodeEscapes(rawPrompt);
  const textLen = prompt.length;
  const cardHeight = node.contentH ?? node.height ?? 200;
  const hasPrompt = prompt.trim().length > 0;
  // 音乐模式的可生成判定：灵感要描述，自定义要歌词，延长/翻唱要原曲。
  const musicReady = isMusic && validateMusicParams(prompt, music) === null;
  const canGenerate = isMusic ? musicReady : hasPrompt;

  // 分轨播放地址：有分轨按选中项，否则回落 audioSrc。
  const tracks = node.audioTracks ?? [];
  const activeTrack = tracks[Math.min(trackIdx, Math.max(0, tracks.length - 1))];
  const playSrc = activeTrack?.url || node.audioSrc;

  useEffect(() => {
    if (rawPrompt && rawPrompt !== prompt) {
      updateNode(node.id, { prompt }, false);
    }
  }, [node.id, prompt, rawPrompt, updateNode]);

  const keepPanelFocus = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  // commit 默认 false:该函数是提示词输入框的 onChange,每次键入都记历史会把
  // 撤销栈灌满打字快照(Ctrl+Z 一次退一个字符、redo 被任何键入清空),与其它
  // 节点的 prompt 更新口径一致(updateNode 默认不记历史)。
  const updatePrompt = useCallback((next: string, commit = false) => {
    updateNode(node.id, { prompt: next.slice(0, MAX_TEXT) }, commit);
  }, [node.id, updateNode]);

  const requestCanvasSaveNow = useCallback(() => {
    window.setTimeout(() => window.dispatchEvent(new Event("tide-canvas-save-now")), 0);
  }, []);

  const insertPromptToken = useCallback((rawToken: string) => {
    if (promptEditorRef.current) {
      promptEditorRef.current.insertToken(rawToken);
      requestCanvasSaveNow();
      return;
    }
    updatePrompt(prompt + (prompt && !/\s$/.test(prompt) ? " " : "") + rawToken);
    requestCanvasSaveNow();
  }, [prompt, requestCanvasSaveNow, updatePrompt]);

  const insertCustomPause = useCallback(() => {
    const seconds = Number(customPauseValue);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      toast.error("请输入有效的停顿时间");
      return;
    }
    const normalized = Math.min(Math.max(seconds, 0.1), 10);
    const formatted = normalized % 1 === 0 ? normalized.toFixed(1) : String(Math.round(normalized * 100) / 100);
    insertPromptToken("<#" + formatted + "#>");
    setActiveTokenMenu(null);
  }, [customPauseValue, insertPromptToken]);

  const handleGenerate = () => {
    if (generating) return;
    if (isMusic) {
      const err = validateMusicParams(prompt, music);
      if (err) {
        toast.info(err);
        return;
      }
      // 音乐：四模式组装（与创作台/chat 同构，自定义/延长/翻唱不发描述）。
      generate({
        nodeId: node.id,
        handler: "text_to_audio",
        modelId: modelId || "default",
        input: buildMusicInput(prompt, music),
      });
      setTrackIdx(0);
      return;
    }
    if (!hasPrompt) return;
    generate({
      nodeId: node.id,
      handler: "text_to_audio",
      modelId: modelId || "default",
      input: {
        prompt,
        ...(effectiveVoice ? { voice: effectiveVoice } : {}),
      },
    });
  };


  return (
    <NodeShell node={node} isSelected={isSelected} isDragging={isDragging} onNodeMouseDown={onNodeMouseDown}>
      <div className="relative">
        <div
          className={`relative overflow-hidden rounded-[18px] bg-white shadow-sm ring-1 transition-all dark:bg-neutral-950 ${
            isConnectTarget ? "ring-2 ring-blue-500/70" :
            isSelected ? "ring-2 ring-neutral-400 dark:ring-neutral-600" : "ring-neutral-200 hover:ring-neutral-300 dark:ring-neutral-800 dark:hover:ring-neutral-700"
          }`}
          style={{ height: cardHeight }}
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(59,130,246,0.10),transparent_34%),radial-gradient(circle_at_82%_18%,rgba(16,185,129,0.08),transparent_30%)]" />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/80 to-transparent dark:via-white/15" />

          {generating && (
            <div className="absolute inset-0 z-[5] flex items-center justify-center bg-white/75 backdrop-blur-sm dark:bg-neutral-950/75">
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-neutral-200 bg-white/90 px-5 py-4 shadow-lg dark:border-neutral-800 dark:bg-neutral-900/90">
                <Loader2 className="h-7 w-7 animate-spin text-blue-500" />
                <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                  {isMusic ? "音乐生成中..." : isSfx ? "音效生成中..." : "语音合成中..."}
                </p>
              </div>
            </div>
          )}

          <div className="relative flex h-full flex-col px-5 py-4">

            <div className="flex min-h-0 flex-1 items-center justify-center">
              <div className="flex w-full flex-col items-center gap-4">
                <div className="flex items-end justify-center gap-1.5">
                  {WAVE_BARS.map((h, i) => (
                    <span
                      key={i}
                      className={`w-1.5 rounded-full ${
                        node.audioSrc || generating
                          ? "bg-blue-500/80 shadow-[0_0_14px_rgba(59,130,246,0.24)]"
                          : "bg-neutral-300 dark:bg-neutral-700"
                      }`}
                      style={{ height: h }}
                    />
                  ))}
                </div>
                {!playSrc && (
                  <div className="flex max-w-full items-center gap-2 rounded-xl border border-neutral-200/80 bg-white/80 px-3 py-2 text-sm text-neutral-700 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/80 dark:text-neutral-300">
                    <Music2 className="h-4 w-4 shrink-0 text-neutral-500" />
                    <span className="truncate">
                      {isMusic ? "描述你想要的音乐" : isSfx ? "描述你想要的音效" : "输入文本生成音频"}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {playSrc && (
              <div className="rounded-2xl border border-neutral-200/80 bg-white/85 p-2 shadow-sm backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/85">
                {/* Suno 一次两首：分轨在节点内切换（标题来自上游 tracks） */}
                {tracks.length > 1 && (
                  <div className="mb-1.5 flex items-center gap-1 px-1">
                    {tracks.map((t, i) => (
                      <button
                        key={t.url}
                        type="button"
                        onMouseDown={stop}
                        onClick={(e) => {
                          stop(e);
                          setTrackIdx(i);
                        }}
                        className={`max-w-[45%] truncate rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
                          i === trackIdx
                            ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                            : "bg-neutral-100 text-neutral-500 hover:text-neutral-800 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
                        }`}
                      >
                        {t.title || `曲目 ${i + 1}`}
                      </button>
                    ))}
                  </div>
                )}
                <audio
                  key={playSrc}
                  src={playSrc}
                  controls
                  preload="metadata"
                  onMouseDown={stop}
                  className="w-full"
                  style={{ height: 36 }}
                />
              </div>
            )}
          </div>
        </div>

        <NodeHeader icon={AudioLines} title={node.title || "音频节点"} visible={showAuxUI} overlay />
        <NodePorts nodeId={node.id} visible={showAuxUI} overlay onPortMouseDown={onPortMouseDown} />
        <CanvasSkillRunNodeShortcut nodeId={node.id} nodeType={node.type} visible={showAuxUI} />

        {showAuxUI && (
          <NodePanelChrome width={660}>
              <AudioPromptEditor
                ref={promptEditorRef}
                value={prompt}
                onChange={updatePrompt}
                placeholder={
                  isMusic
                    ? musicMode === "inspire"
                      ? "描述你想要的音乐，Suno 自动作曲填词..."
                      : musicMode === "custom"
                        ? "备注（仅作记录，不参与生成）· 歌词在下方填写"
                        : "备注（仅作记录，不参与生成）· 原曲在下方选择"
                    : isSfx
                      ? "描述你想要的音效..."
                      : "输入要合成的语音文本..."
                }
                expanded={false}
              />

              {/* 音乐四创作模式（对齐创作台：灵感 / 自定义歌词 / 延长 / 翻唱） */}
              {isMusic && (
                <div className="mt-3 flex flex-col gap-2.5 px-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {MUSIC_MODES.map((o) => (
                      <button
                        key={o.v}
                        type="button"
                        onMouseDown={keepPanelFocus}
                        onClick={(e) => {
                          stop(e);
                          setMusic((m) => ({ ...m, musicMode: o.v }));
                        }}
                        className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                          musicMode === o.v
                            ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                            : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white"
                        }`}
                      >
                        {o.l}
                      </button>
                    ))}
                    <span className="mx-1 h-4 w-px bg-neutral-200 dark:bg-neutral-800" />
                    {/* 人声/纯音乐（上游 make_instrumental，各模式通吃） */}
                    {[
                      { v: false, l: "有人声" },
                      { v: true, l: "纯音乐" },
                    ].map((o) => (
                      <button
                        key={o.l}
                        type="button"
                        onMouseDown={keepPanelFocus}
                        onClick={(e) => {
                          stop(e);
                          setMusic((m) => ({ ...m, instrumental: o.v }));
                        }}
                        className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                          music.instrumental === o.v
                            ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                            : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white"
                        }`}
                      >
                        {o.l}
                      </button>
                    ))}
                  </div>

                  {(musicMode === "extend" || musicMode === "cover") && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        title="选择本站生成的歌，或上传本地音频（mp3 / wav）"
                        onMouseDown={stop}
                        onClick={(e) => {
                          stop(e);
                          setClipPickerOpen(true);
                        }}
                        className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2 text-left text-xs text-neutral-900 outline-none transition-colors hover:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100 dark:hover:border-neutral-600"
                      >
                        <span className={`min-w-0 flex-1 truncate ${music.sourceClipId ? "" : "text-neutral-400"}`}>
                          {clipLabel}
                        </span>
                        <ChevronDown className="h-3 w-3 shrink-0 text-neutral-400" />
                      </button>
                      {musicMode === "extend" && (
                        <input
                          value={music.continueAt}
                          onMouseDown={stop}
                          onChange={(e) => setMusic((m) => ({ ...m, continueAt: e.target.value }))}
                          inputMode="numeric"
                          placeholder="延长起点 · 秒 · 选填"
                          className="h-8 w-[150px] rounded-md border border-neutral-200 bg-white px-2 text-xs text-neutral-900 outline-none focus:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100"
                        />
                      )}
                    </div>
                  )}

                  <ClipPicker
                    open={clipPickerOpen}
                    options={clipOpts}
                    current={music.sourceClipId}
                    onClose={() => setClipPickerOpen(false)}
                    onPick={handlePickClip}
                    // 登记完成即并入候选(可能不自动选中:用户等待期间已另选原曲)
                    onUploaded={(opt) =>
                      setClipOpts((prev) => (prev?.some((o) => o.clipId === opt.clipId) ? prev : [opt, ...(prev ?? [])]))}
                    upload={{
                      generateModelId: modelId || "default",
                      modelRowId: selectedModel?.id,
                      modelName: selectedModel?.name,
                      // 登记价:模型 config.uploadCost,未配置时服务端按常规生成价扣,展示同口径
                      cost: Math.ceil(uploadCostOf(selectedModel?.config) || Number(selectedModel?.pointCost ?? 0)),
                    }}
                  />

                  {musicMode !== "inspire" && (
                    <>
                      <textarea
                        value={music.lyrics}
                        onMouseDown={stop}
                        onChange={(e) => setMusic((m) => ({ ...m, lyrics: e.target.value }))}
                        placeholder={
                          musicMode === "custom"
                            ? "歌词 · 必填 · Suno 按歌词演唱，支持段落标记\n[Verse]\n阳光洒在肩上\n[Chorus]\n这就是青春的模样"
                            : musicMode === "extend"
                              ? "续写歌词 · 选填 · 留空则由 Suno 续写"
                              : "改编提示 / 歌词 · 选填 · 留空则保留原词"
                        }
                        className="thin-scroll min-h-[96px] w-full resize-y rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-xs leading-5 text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100"
                      />
                      <div className="flex flex-wrap items-center gap-1.5">
                        {AUDIO_STYLES.map((s) => {
                          const on = music.songStyles.includes(s.v);
                          return (
                            <button
                              key={s.v}
                              type="button"
                              onMouseDown={keepPanelFocus}
                              onClick={(e) => {
                                stop(e);
                                setMusic((m) => ({
                                  ...m,
                                  songStyles: on
                                    ? m.songStyles.filter((x) => x !== s.v)
                                    : [...m.songStyles, s.v],
                                }));
                              }}
                              className={`flex h-7 items-center rounded-lg border px-2.5 text-xs font-medium transition-colors ${
                                on
                                  ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                                  : "border-neutral-200 text-neutral-500 hover:border-neutral-300 hover:text-neutral-900 dark:border-neutral-800 dark:text-neutral-400 dark:hover:border-neutral-600 dark:hover:text-white"
                              }`}
                            >
                              {s.l}
                            </button>
                          );
                        })}
                        <input
                          value={music.songTitle}
                          onMouseDown={stop}
                          onChange={(e) => setMusic((m) => ({ ...m, songTitle: e.target.value }))}
                          placeholder="歌名 · 选填"
                          className="h-7 min-w-[140px] flex-1 rounded-lg border border-neutral-200 bg-white px-2.5 text-xs text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100"
                        />
                      </div>
                    </>
                  )}
                </div>
              )}

              {!isMusic && (
              <div className="mt-3 px-2">
                <div className="relative flex min-w-0 flex-wrap items-center gap-1.5">
                  <div className="relative">
                    <button
                      type="button"
                      onMouseDown={keepPanelFocus}
                      onClick={(e) => { stop(e); setActiveTokenMenu((v) => (v === "pause" ? null : "pause")); }}
                      className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-200 hover:text-neutral-950 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-white"
                      title="设置并插入停顿时间"
                    >
                      {"<#> 停顿"}
                    </button>
                    {activeTokenMenu === "pause" && (
                      <div
                        onMouseDown={stop}
                        onWheelCapture={(e) => e.stopPropagation()}
                        onWheel={(e) => e.stopPropagation()}
                        className="absolute left-0 top-[calc(100%+8px)] z-20 w-[126px] rounded-xl border border-neutral-200 bg-white p-1.5 shadow-xl shadow-neutral-900/12 dark:border-neutral-800 dark:bg-neutral-950 dark:shadow-black/30"
                      >
                        {PAUSE_OPTIONS.map((item) => (
                          <button
                            key={item.token}
                            type="button"
                            onMouseDown={keepPanelFocus}
                            onClick={(e) => { stop(e); insertPromptToken(item.token); setActiveTokenMenu(null); }}
                            className="block w-full rounded-lg px-3 py-2 text-left text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-sky-600 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-sky-300"
                          >
                            {item.label}
                          </button>
                        ))}
                        <div className="mt-1 border-t border-neutral-100 pt-1 dark:border-neutral-800">
                          <div className="px-3 py-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">自定义</div>
                          <div className="flex items-center gap-1 px-2 pb-1">
                            <input
                              value={customPauseValue}
                              onChange={(e) => setCustomPauseValue(e.target.value)}
                              onMouseDown={stop}
                              onKeyDown={(e) => { if (e.key === "Enter") insertCustomPause(); }}
                              inputMode="decimal"
                              className="h-7 min-w-0 flex-1 rounded-md border border-neutral-200 bg-white px-2 text-xs text-neutral-900 outline-none focus:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100"
                            />
                            <span className="text-xs text-neutral-400">s</span>
                            <button
                              type="button"
                              onMouseDown={keepPanelFocus}
                              onClick={(e) => { stop(e); insertCustomPause(); }}
                              className="rounded-md px-2 py-1 text-xs font-medium text-sky-600 hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-950/50"
                            >
                              插入
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="relative">
                    <button
                      type="button"
                      onMouseDown={keepPanelFocus}
                      onClick={(e) => { stop(e); setActiveTokenMenu((v) => (v === "tone" ? null : "tone")); }}
                      className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-200 hover:text-neutral-950 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-white"
                      title="插入语气词"
                    >
                      {"() 语气词"}
                    </button>
                    {activeTokenMenu === "tone" && (
                      <div
                        onMouseDown={keepPanelFocus}
                        onWheelCapture={(e) => e.stopPropagation()}
                        onWheel={(e) => e.stopPropagation()}
                        className="absolute left-0 top-[calc(100%+8px)] z-20 max-h-[238px] w-[128px] overflow-y-auto rounded-xl border border-neutral-200 bg-white p-1.5 shadow-xl shadow-neutral-900/12 dark:border-neutral-800 dark:bg-neutral-950 dark:shadow-black/30"
                      >
                        {TONE_OPTIONS.map((item) => (
                          <button
                            key={item.token}
                            type="button"
                            onMouseDown={keepPanelFocus}
                            onClick={(e) => { stop(e); insertPromptToken(item.token); setActiveTokenMenu(null); }}
                            className="block w-full rounded-lg px-3 py-2 text-left text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-white"
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              )}

              <div className="mt-3 flex items-center justify-between gap-2 px-2">
                <div className="flex min-w-0 items-center gap-1 text-xs text-neutral-600 dark:text-neutral-400">
                  <ModelPicker models={models} value={modelId} onChange={setModelId} />
                  {!isMusic && voices.length > 0 && (
                    <span className="flex min-w-0 items-center gap-1 rounded-md px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                      <Mic2 className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                      <select
                        value={effectiveVoice}
                        onChange={(e) => setVoice(e.target.value)}
                        onMouseDown={stop}
                        className="max-w-[132px] cursor-pointer truncate bg-transparent text-xs font-medium outline-none dark:bg-neutral-950"
                      >
                        {voices.map((v) => (
                          <option key={v.id} value={v.id}>{v.name}</option>
                        ))}
                      </select>
                    </span>
                  )}
                  <button onMouseDown={stop} title="音频参数" className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="flex shrink-0 items-center gap-2 text-xs text-neutral-500">
                  <span className="tabular-nums text-neutral-400">{textLen}/{MAX_TEXT}</span>
                  <span className="flex items-center gap-0.5">
                    <Zap className="h-3 w-3 text-neutral-900 dark:text-neutral-100" fill="currentColor" />
                    {cost}
                  </span>
                  <GenerateSubmitButton
                    disabled={!canGenerate || generating}
                    generating={generating}
                    title={
                      generating
                        ? "生成中..."
                        : !canGenerate
                          ? (isMusic ? validateMusicParams(prompt, music) ?? "先填写必填项" : "先输入文案")
                          : isMusic
                            ? "开始生成"
                            : "开始合成"
                    }
                    onClick={handleGenerate}
                  />
                </div>
              </div>
          </NodePanelChrome>
        )}
      </div>
    </NodeShell>
  );
});
