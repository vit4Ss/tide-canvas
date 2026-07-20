"use client";

/* ============================================================================
   ClipPicker — 延长/翻唱的原曲选择弹窗(画布音频节点/对话页/创作台共用)。

   替代原生下拉:Suno 一次生成两首同名歌,下拉框里全是重复标题无从分辨。
   这里按"封面 + 歌名 + 第 N 首标记 + 模型/时长/日期"逐行展示,并支持逐条
   试听,点行即选中。原曲两个来源:本站生成历史,或本地 mp3/wav 上传登记
   (upload prop 开启;上游三步流的前两步在弹窗内完成,成功后与站内原曲
   一样走 onPick,option.isUpload=true)。
   ========================================================================== */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2, Music2, Pause, Play, Upload, X } from "lucide-react";
import { toast } from "@/components/shared/toast";
import { uploadAndRegisterClip, type ClipOption, type UploadClipStage } from "@/lib/music-modes";

function fmtDuration(sec: number): string {
  if (!sec || !Number.isFinite(sec)) return "";
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function fmtDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const d = new Date(t);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

interface Props {
  open: boolean;
  /** null = 候选仍在加载 */
  options: ClipOption[] | null;
  /** 当前已选 clipId(高亮回显) */
  current: string;
  onClose: () => void;
  onPick: (opt: ClipOption) => void;
  /** 上传登记完成(无论是否自动选中)——把新原曲并入候选列表供回显/再选。
      与 onPick 分开:登记期间用户可能已手选别的原曲,此时不覆盖其选择。 */
  onUploaded?: (opt: ClipOption) => void;
  /** 本地音频上传登记(传入即显示上传入口)。clip 会被钉在执行登记的模型卡
      路由上,generateModelId 必须是之后做延长/翻唱的同一张卡。 */
  upload?: {
    generateModelId: string;
    modelRowId?: string;
    modelName?: string;
    /** 登记一次实扣积分(已含团队倍率);0/缺省不展示价签 */
    cost?: number;
  };
}

export function ClipPicker({ open, options, current, onClose, onPick, onUploaded, upload }: Props) {
  // 试听:真实 <audio> 元素随弹窗一起挂载/卸载(关闭即自动停播,无需手动清理);
  // 换源由 previewSrc 状态驱动,播放在 src 落地后的 effect 里触发(与
  // audio-player-card 的元素式播放惯用法一致)。
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  // 本地音频上传登记:上传→登记(上游转存并分配 clip)两个阶段,期间禁止重复
  // 发起。弹窗关闭不中断流程(登记已扣积分,丢结果=白扣),完成后照常 onPick。
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploadStage, setUploadStage] = useState<UploadClipStage | null>(null);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  // 登记异步完成时要读「此刻」的选中项(props 闭包里是发起时的旧值):
  // 用户等待期间手选了别的原曲就不覆盖,经 ref 取最新 current 判断。
  const currentRef = useRef(current);
  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  // 播放代次:每次换源自增。换源会让上一次 play() 以 AbortError 拒绝,此时
  // 新歌已在播,旧的 catch 不能清空 playingId(否则快速切歌后图标灭掉但声音还在)。
  const playSeqRef = useRef(0);

  useEffect(() => {
    if (!previewSrc) return;
    const seq = ++playSeqRef.current;
    void audioRef.current?.play().catch(() => {
      if (playSeqRef.current === seq) setPlayingId(null); // 仍是本次播放才复位
    });
  }, [previewSrc]);

  // 关闭/选中统一走这里:复位试听状态,避免重开时残留"播放中"图标
  const close = () => {
    setPlayingId(null);
    setPreviewSrc(null);
    onClose();
  };
  const pick = (opt: ClipOption) => {
    setPlayingId(null);
    setPreviewSrc(null);
    onPick(opt);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPlayingId(null);
        setPreviewSrc(null);
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handleFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // 同一文件再次选择也要触发 change
    if (!file || !upload || uploadStage) return;
    setUploadErr(null);
    setUploadStage("uploading");
    // 记下发起时的选中项:完成时若选中项已变,说明用户等待期间另有主张,不覆盖
    const currentAtStart = current;
    try {
      const opt = await uploadAndRegisterClip({
        file,
        generateModelId: upload.generateModelId,
        modelRowId: upload.modelRowId,
        modelName: upload.modelName,
        onStage: setUploadStage,
      });
      // 无论是否选中,都先并入候选列表,保证列表里能找到/回显
      onUploaded?.(opt);
      // 走全局 toast:登记耗时约 1 分钟且允许关窗等待,结果必须在弹窗外也可见
      if (currentRef.current === currentAtStart) {
        toast.success(`「${opt.label}」已登记为原曲`);
        pick(opt);
      } else {
        toast.success(`「${opt.label}」已登记，可在原曲列表中选用`);
      }
    } catch (err) {
      const msg = (err as Error)?.message || "上传登记失败，请重试";
      setUploadErr(msg);
      toast.error(msg);
    } finally {
      setUploadStage(null);
    }
  };

  const togglePreview = (opt: ClipOption) => {
    if (!opt.url) return;
    if (playingId === opt.clipId) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    setPlayingId(opt.clipId);
    if (previewSrc === opt.url) {
      // 同源重播(同一首暂停后再点):src 不变不触发 effect,直接播
      const a = audioRef.current;
      if (a) {
        const seq = ++playSeqRef.current;
        a.currentTime = 0;
        void a.play().catch(() => {
          if (playSeqRef.current === seq) setPlayingId(null);
        });
      }
    } else {
      setPreviewSrc(opt.url);
    }
  };

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    // stopPropagation 必须做:portal 的事件沿 React 组件树(而非 DOM 树)冒泡,
    // 本组件挂在画布音频节点之下,遮罩上的 mousedown 不拦会一路冒到节点根部的
    // 拖拽处理器,点一下遮罩顺手把弹窗后面的节点拖走。
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-6"
      onMouseDown={(e) => {
        e.stopPropagation();
        close();
      }}
    >
      <div
        className="flex max-h-[70vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-neutral-900"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 试听播放器:随弹窗卸载自动停播 */}
        <audio
          ref={audioRef}
          src={previewSrc ?? undefined}
          preload="none"
          className="hidden"
          onEnded={() => setPlayingId(null)}
          onError={() => setPlayingId(null)}
        />
        <div className="flex items-start justify-between border-b border-neutral-100 px-5 py-4 dark:border-neutral-800">
          <div>
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">选择原曲</h3>
            <p className="mt-0.5 text-xs text-neutral-400">
              {upload
                ? "选择本站生成的歌，或上传本地音频 · 同名两首可试听区分"
                : "仅支持续写 / 翻唱本站生成的音乐 · 同名两首可试听区分"}
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={close}
            className="rounded-lg p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {upload && (
          <div className="border-b border-neutral-100 px-3 py-2 dark:border-neutral-800">
            <input
              ref={fileRef}
              type="file"
              accept=".mp3,.wav,audio/mpeg,audio/wav"
              className="hidden"
              onChange={handleFilePicked}
            />
            <button
              type="button"
              disabled={!!uploadStage}
              onClick={() => fileRef.current?.click()}
              className="flex w-full items-center gap-3 rounded-xl border border-dashed border-neutral-200 px-3 py-2.5 text-left transition-colors hover:border-neutral-400 disabled:cursor-default disabled:hover:border-neutral-200 dark:border-neutral-700 dark:hover:border-neutral-500 dark:disabled:hover:border-neutral-700"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                {uploadStage ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {uploadStage === "uploading"
                    ? "音频上传中…"
                    : uploadStage === "registering"
                      ? "登记中，约需 1 分钟…"
                      : "上传本地音频"}
                </span>
                <span className="mt-0.5 block truncate text-xs text-neutral-400">
                  {uploadStage
                    ? "完成后自动选为原曲，可先关闭窗口"
                    : `mp3 / wav${upload.cost ? ` · 登记一次 ${upload.cost} 积分` : ""}`}
                </span>
              </span>
            </button>
            {uploadErr && !uploadStage && (
              <p className="mt-1.5 px-1 text-xs text-red-500">{uploadErr}</p>
            )}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
          {options === null ? (
            <div className="flex h-36 items-center justify-center text-neutral-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : options.length === 0 ? (
            <div className="flex h-36 flex-col items-center justify-center gap-2 px-6 text-center text-neutral-400">
              <Music2 className="h-6 w-6" />
              <p className="text-xs leading-5">
                暂无可选原曲
                <br />
                {upload ? "先生成一首音乐，或上传本地音频" : "先生成一首音乐,完成后会出现在这里"}
              </p>
            </div>
          ) : (
            options.map((opt) => {
              const selected = current === opt.clipId;
              const playing = playingId === opt.clipId;
              return (
                <div
                  key={opt.clipId}
                  role="button"
                  tabIndex={0}
                  onClick={() => pick(opt)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      pick(opt);
                    }
                  }}
                  className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors ${
                    selected
                      ? "bg-neutral-50 dark:bg-neutral-800/60"
                      : "hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
                  }`}
                >
                  {/* 封面 + 试听:按钮叠在封面上,点击不冒泡到选中 */}
                  <button
                    type="button"
                    aria-label={playing ? "暂停试听" : "试听"}
                    disabled={!opt.url}
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePreview(opt);
                    }}
                    className="group relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-800"
                  >
                    {opt.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={opt.coverUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-neutral-400">
                        <Music2 className="h-4 w-4" />
                      </span>
                    )}
                    {opt.url && (
                      <span
                        className={`absolute inset-0 flex items-center justify-center bg-black/40 text-white transition-opacity ${
                          playing ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                        }`}
                      >
                        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                      </span>
                    )}
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                        {opt.label}
                      </span>
                      {opt.trackCount > 1 && (
                        <span className="shrink-0 rounded border border-neutral-200 px-1 text-[10px] leading-4 text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
                          第 {opt.trackNo} 首
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-neutral-400">
                      {[opt.modelName, fmtDuration(opt.duration), fmtDate(opt.createTime)]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>

                  {selected && <Check className="h-4 w-4 shrink-0 text-neutral-900 dark:text-neutral-100" />}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
