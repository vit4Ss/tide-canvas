/* 音频（Suno）音乐创作的「创作模式 + 原曲选择 + 延长起点」字段区 — 从
   create-studio.tsx 抽出（纯移动，无逻辑改动）。父组件按 isAudio && !isSfx
   条件渲染；内部再按 musicMode 细分（延长/翻唱才显示原曲块）。 */

import { ClipPicker } from "@/components/studio/clip-picker";
import type { StudioModelVO } from "@/lib/market-api";
import { findClipModel, uploadCostOf, type ClipOption } from "@/lib/music-modes";
import { toast } from "@/components/shared/toast";
import type { MusicMode } from "./types";
import { audioToolOf } from "./utils";
import type { useSourceClip } from "./use-source-clip";

export function MusicSourceFields({
  musicMode,
  onMusicModeChange,
  clip,
  clipOptions,
  selModel,
  studioList,
  model,
  onModelChange,
}: {
  musicMode: MusicMode;
  onMusicModeChange: (m: MusicMode) => void;
  clip: ReturnType<typeof useSourceClip>;
  clipOptions: ClipOption[];
  selModel: StudioModelVO | null;
  studioList: StudioModelVO[];
  model: string;
  onModelChange: (name: string) => void;
}) {
  const {
    sourceClipId,
    setSourceClipId,
    setSourceIsUpload,
    continueAt,
    setContinueAt,
    extraClips,
    setExtraClips,
    clipPickOpen,
    setClipPickOpen,
    clipChanging,
    setClipChanging,
    clipFileRef,
    clipUploadStage,
  } = clip;

  return (
    <>
      {/* 音乐创作模式（对齐 Suno API：灵感 = 描述生成，自定义 = 按歌词演唱，
          延长/翻唱 = 引用先前生成的原曲 clip） */}
      <div className="ws-field col" id="fieldMusicMode">
        <label>创作模式</label>
        <div className="ws-ratios">
          {(
            [
              { v: "inspire", l: "灵感模式" },
              { v: "custom", l: "自定义歌词" },
              { v: "extend", l: "延长" },
              { v: "cover", l: "翻唱" },
            ] as const
          ).map((o) => (
            <button
              key={o.v}
              type="button"
              className={`ratio${musicMode === o.v ? " on" : ""}`}
              onClick={() => onMusicModeChange(o.v)}
            >
              {o.l}
            </button>
          ))}
        </div>
      </div>

      {/* 延长/翻唱：原曲选择（候选 = 用户历史生成的分轨；上游只认自己的 clip） */}
      {(musicMode === "extend" || musicMode === "cover") && (
        <>
          <div className="ws-field col" id="fieldSourceClip">
            <label>原曲 · 必选</label>
            {(() => {
              const sel = clipOptions.find((o) => o.clipId === sourceClipId);
              const uploadCost = selModel
                ? uploadCostOf(selModel.config) || parseFloat(selModel.pointCost ?? "") || 0
                : 0;
              // 上传登记进行中:整块显示进度条态,禁交互
              if (clipUploadStage) {
                return (
                  <div className="ws-clipcard is-busy">
                    <span className="ws-rh-spin" aria-hidden />
                    <span className="tx">
                      <b>{clipUploadStage === "uploading" ? "音频上传中…" : "登记中，约需 1 分钟…"}</b>
                      <i>完成后自动选为原曲，可先离开此页</i>
                    </span>
                  </div>
                );
              }
              // 已选且不在更换态:展示所选原曲卡片 + 更换
              if (sourceClipId && !clipChanging) {
                return (
                  <div className="ws-clipcard">
                    <span className="cover">
                      {sel?.coverUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={sel.coverUrl} alt="" />
                      ) : (
                        <span aria-hidden>♪</span>
                      )}
                    </span>
                    <span className="tx">
                      <b className="truncate">
                        {sel
                          ? sel.trackCount > 1
                            ? `${sel.label} · 第 ${sel.trackNo} 首`
                            : sel.label
                          : "历史原曲"}
                      </b>
                      <i className="truncate">
                        {sel
                          ? [
                              sel.modelName,
                              sel.duration
                                ? `${Math.floor(sel.duration / 60)}:${String(Math.round(sel.duration) % 60).padStart(2, "0")}`
                                : "",
                              sel.isUpload ? "上传" : "",
                            ]
                              .filter(Boolean)
                              .join(" · ")
                          : "已选择"}
                      </i>
                    </span>
                    <button type="button" className="chg" onClick={() => setClipChanging(true)}>
                      更换
                    </button>
                  </div>
                );
              }
              // 未选 / 更换态:两个来源选项内联展示(本地上传 / 从资产库选取)
              return (
                <div className="ws-clipsrc">
                  <button
                    type="button"
                    className="ws-srcopt"
                    disabled={!selModel}
                    style={!selModel ? { opacity: 0.5, cursor: "default" } : undefined}
                    onClick={() => clipFileRef.current?.click()}
                  >
                    <span className="ic">⤓</span>
                    <span className="tx">
                      <b>本地上传</b>
                      <i>mp3 / wav{uploadCost ? ` · 登记一次 ${uploadCost} 积分` : ""}</i>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="ws-srcopt"
                    onClick={() => setClipPickOpen(true)}
                  >
                    <span className="ic">▦</span>
                    <span className="tx">
                      <b>从资产库选取</b>
                      <i>选择你生成过的歌 · 可试听</i>
                    </span>
                  </button>
                  {sourceClipId && (
                    <button type="button" className="ws-clipsrc-cancel" onClick={() => setClipChanging(false)}>
                      取消
                    </button>
                  )}
                </div>
              );
            })()}
            <ClipPicker
              open={clipPickOpen}
              variant="dialog"
              extraOptions={extraClips}
              // 音效片段不可延长/翻唱,直接不进列表;模型卡匹配不上的
              // (已下架等)无从判定,保留展示,由 onPick 的拦截兜底
              filterOption={(opt) => {
                const src = findClipModel(studioList, opt);
                return !src || audioToolOf(src) !== "sfx";
              }}
              current={sourceClipId}
              onClose={() => setClipPickOpen(false)}
              onPick={(opt) => {
                // 音效片段不可做原曲:选中会自动切到音效模型卡,isSfx 置真后
                // 整个延长/翻唱表单被隐藏,点生成会静默退化成普通音效生成。
                // 就地拦下,弹窗不关,让用户换选一首音乐。
                const src = findClipModel(studioList, opt);
                if (src && audioToolOf(src) === "sfx") {
                  toast.info("音效片段不支持延长 / 翻唱，请选择一首音乐");
                  return;
                }
                setSourceClipId(opt.clipId);
                // 上传登记的原曲延长时须发 upload_extend,来源标记随选中项走
                setSourceIsUpload(!!opt.isUpload);
                setClipPickOpen(false);
                setClipChanging(false);
                // 刚登记完成的上传原曲还没进 hist,记入会话内附加候选供回显
                setExtraClips((prev) =>
                  prev.some((o) => o.clipId === opt.clipId) ? prev : [opt, ...prev]);
                // 上游把延长/翻唱任务钉到原曲的模型路由,选定原曲后自动切回原曲那张模型卡
                if (src && src.name !== model) {
                  onModelChange(src.name);
                  toast.info(`已切换到原曲模型「${src.name}」`);
                } else if (!src && (opt.modelId || opt.modelName)) {
                  toast.info("原曲所用模型已下架，续写/翻唱可能失败");
                }
              }}
            />
          </div>
          {musicMode === "extend" && (
            <div className="ws-field col" id="fieldContinueAt">
              <label>延长起点 · 秒 · 选填</label>
              <input
                className="ws-audio-in"
                type="text"
                inputMode="numeric"
                value={continueAt}
                onChange={(e) => setContinueAt(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="留空 = 从原曲结尾续写"
              />
            </div>
          )}
        </>
      )}
    </>
  );
}
