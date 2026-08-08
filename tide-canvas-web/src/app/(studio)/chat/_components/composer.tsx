"use client";

/* ── composer (extracted verbatim from page.tsx) ───────────────────────────────
   上下文用量条 / 技能 chip / 参考素材条 / 拖放遮罩 / MentionPromptEditor(@ 引用)
   / 音乐四模式参数区 / 芯片行(联网·模型·模式·比例·分辨率·画质·时长·批量)
   / 积分预估 / 发送按钮。状态全部来自 _hooks 的三个 bag，本文件纯渲染。 */

import { Sparkles, X as XIcon } from "lucide-react";
import { toast } from "@/components/shared/toast";
import {
  MentionPromptEditor,
  type MentionEditorHandle,
} from "@/components/studio/mention-prompt-editor";
import { ClipPicker } from "@/components/studio/clip-picker";
import {
  AUDIO_STYLES,
  MUSIC_MODES,
  uploadCostOf,
  clipDisplayLabel,
  findClipModel,
} from "@/lib/music-modes";
import type { ContextUsageVO } from "@/types/chat";
import { CmSelect, RatioBox } from "./cm-select";
import { RefThumb } from "./ref-thumb";
import {
  MODE_HINT,
  MODE_LABEL,
  MUSIC_MODE_HINT,
  QUALITY_LABEL,
  swatchOf,
  typeTag,
  type LightboxItem,
} from "./chat-utils";
import type { GenModelsApi } from "../_hooks/use-gen-models";
import type { ComposerConfigApi } from "../_hooks/use-composer-config";
import type { ReferencesApi } from "../_hooks/use-references";

export function Composer({
  models,
  cfg,
  refsApi,
  draft,
  setDraft,
  taRef,
  send,
  busy,
  ctxUsage,
  newChat,
  openLightbox,
}: {
  models: GenModelsApi;
  cfg: ComposerConfigApi;
  refsApi: ReferencesApi;
  draft: string;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  taRef: React.RefObject<MentionEditorHandle | null>;
  send: () => void;
  busy: boolean;
  ctxUsage: ContextUsageVO | null;
  newChat: () => void;
  openLightbox: (items: LightboxItem[], index: number) => void;
}) {
  const {
    genModels,
    model,
    selModel,
    mCfg,
    isVid,
    webSearchAvail,
    modelNames,
    swatchByName,
    selSwatch,
  } = models;
  const {
    web,
    setWeb,
    mode,
    setMode,
    ratio,
    setRatio,
    res,
    setRes,
    quality,
    setQuality,
    dur,
    setDur,
    skill,
    removeSkill,
    setSkillPickerOpen,
    batch,
    setBatch,
    openSel,
    setOpenSel,
    toggleSel,
    music,
    setMusic,
    clipOpts,
    setClipOpts,
    clipPickOpen,
    setClipPickOpen,
    modeVals,
    ratioOpts,
    resOpts,
    qualOpts,
    durOpts,
    countOpts,
    refPolicy,
    isAudioSel,
    isMusicSel,
    musicMode,
    musicNoDraftOk,
    selectModel,
    points,
  } = cfg;
  const {
    refs,
    removeRef,
    attachFiles,
    mentionRefs,
    dragOver,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    fileInputRef,
    openSrcMenu,
  } = refsApi;

  return (
    <div className="chat-composer">
      {/* 已压缩且余量健康时给个安静的说明；仍逼近上限（压缩后依旧 ≥80%）
          则继续走下方的警示条 */}
      {selModel?.type === "text" && ctxUsage?.compressed && ctxUsage.percent < 80 && (
        <div className="chat-ctx-note">较早的对话已自动压缩为摘要，模型仍保有前文关键信息</div>
      )}
      {selModel?.type === "text" && ctxUsage && ctxUsage.percent >= 80 && (
        <div className={`chat-ctx-warn${ctxUsage.full ? " full" : ""}`}>
          <span>
            {ctxUsage.full
              ? "本会话上下文已达上限（自动压缩后仍不足），请开启新会话"
              : `本会话上下文已使用 ${ctxUsage.percent}%，接近阈值时会自动压缩较早对话`}
          </span>
          <button type="button" onClick={newChat} disabled={busy}>
            开启新会话
          </button>
        </div>
      )}
      <div
        className={`composer-box${dragOver ? " drag" : ""}`}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {dragOver && <div className="composer-drop">松开以添加参考素材</div>}
        {/* 技能 chip:附着在输入框上方(对齐参考产品),粘性直到手动移除 */}
        {skill && (
          <div className="skill-strip">
            <span className="skill-chip" title={skill.description || skill.title}>
              <Sparkles size={12} aria-hidden />
              {skill.title}
              <button type="button" aria-label="移除技能" onClick={removeSkill}>
                <XIcon size={12} aria-hidden />
              </button>
            </span>
          </div>
        )}
        {refs.length > 0 && (
          <div className="ref-strip">
            {refs.map((r) => (
              <RefThumb
                key={r.key}
                item={r}
                onRemove={() => removeRef(r.key)}
                onOpen={() => {
                  const src = r.url || r.blobUrl;
                  // RefKind 的 "file" 在灯箱里按文档("doc")预览
                  if (src) openLightbox([{ url: src, kind: r.kind === "file" ? "doc" : r.kind, name: r.name }], 0);
                }}
              />
            ))}
          </div>
        )}
        <div className="composer-head">
          {refPolicy && (
            <button
              className="cm-upload"
              title="添加参考素材（本地上传 / 资产库）"
              type="button"
              onClick={openSrcMenu}
            >
              {/* SVG 加号：全角＋字形字面不居中，在圆钮里会偏位 */}
              <svg viewBox="0 0 24 24" aria-hidden style={{ width: 15, height: 15, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" }}>
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          )}
          {/* 对话生成只使用单输出预设；智能技能从画布入口启动。 */}
          {selModel && (
            <button
              className="cm-upload"
              title="选择预设技能"
              type="button"
              onClick={() => setSkillPickerOpen(true)}
            >
              <Sparkles size={14} aria-hidden />
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={refPolicy?.accept}
            style={{ display: "none" }}
            onChange={(e) => {
              if (e.target.files?.length) attachFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <MentionPromptEditor
            ref={taRef}
            className="composer-input"
            value={draft}
            onChange={setDraft}
            refs={mentionRefs}
            onSubmit={() => send()}
            onPasteFiles={refPolicy ? attachFiles : undefined}
            placeholder={
              isMusicSel && musicMode === "custom"
                ? "给这一轮写句备注（仅作记录，不参与生成）· 歌词请在下方填写"
                : isMusicSel && musicMode !== "inspire"
                  ? "给这一轮写句备注（仅作记录，不参与生成）· 原曲在下方选择"
                  : isAudioSel
                    ? "描述你想生成的音乐或音效，Suno 自动作曲填词…"
                    : "描述你想生成的内容，或上传参考素材让模型自由发挥…  @ 引用参考素材"
            }
          />
        </div>

        {/* 音乐四模式的参数区（自定义歌词/延长/翻唱时展开；灵感模式无额外字段） */}
        {isMusicSel && musicMode !== "inspire" && (
          <div className="cm-music">
            {(musicMode === "extend" || musicMode === "cover") && (
              <div className="cm-music-row">
                <span className="cm-music-lab">原曲</span>
                <button
                  type="button"
                  className="cm-music-sel flex items-center gap-1.5 text-left"
                  title="选择本站生成的歌，或上传本地音频（mp3 / wav）"
                  onClick={() => setClipPickOpen(true)}
                >
                  <span
                    className="min-w-0 flex-1 truncate"
                    style={music.sourceClipId ? undefined : { color: "var(--text-faint)" }}
                  >
                    {clipDisplayLabel(clipOpts, music.sourceClipId)}
                  </span>
                  <span aria-hidden style={{ color: "var(--text-faint)", fontSize: 10 }}>▾</span>
                </button>
                <ClipPicker
                  open={clipPickOpen}
                  options={clipOpts}
                  current={music.sourceClipId}
                  onClose={() => setClipPickOpen(false)}
                  onPick={(opt) => {
                    // 上传登记的原曲延长时须发 upload_extend,来源标记随选中项走
                    setMusic((m) => ({ ...m, sourceClipId: opt.clipId, sourceIsUpload: !!opt.isUpload }));
                    setClipPickOpen(false);
                    // 刚登记完成的上传原曲不在已拉取的候选里,插到最前,否则回显成「历史原曲」
                    setClipOpts((prev) => (prev?.some((o) => o.clipId === opt.clipId) ? prev : [opt, ...(prev ?? [])]));
                    // 上游把延长/翻唱任务钉到原曲的模型路由,选定原曲后自动切回原曲那张模型卡
                    const src = findClipModel(genModels, opt);
                    if (src && src.name !== model) {
                      selectModel(src.name);
                      toast.info(`已切换到原曲模型「${src.name}」`);
                    } else if (!src && (opt.modelId || opt.modelName)) {
                      toast.info("原曲所用模型已下架，续写/翻唱可能失败");
                    }
                  }}
                  // 登记完成即并入候选(可能不自动选中:用户等待期间已另选原曲)
                  onUploaded={(opt) =>
                    setClipOpts((prev) => (prev?.some((o) => o.clipId === opt.clipId) ? prev : [opt, ...(prev ?? [])]))}
                  upload={selModel ? {
                    generateModelId: selModel.modelKey || selModel.id,
                    modelRowId: selModel.id,
                    modelName: selModel.name,
                    // 登记价:模型 config.uploadCost,未配置时服务端按常规生成价扣,展示同口径
                    cost: uploadCostOf(mCfg) || parseFloat(selModel.pointCost ?? "0") || 0,
                  } : undefined}
                />
                {musicMode === "extend" && (
                  <input
                    className="cm-music-in num"
                    inputMode="numeric"
                    placeholder="延长起点 · 秒 · 选填"
                    value={music.continueAt}
                    onChange={(e) => setMusic((m) => ({ ...m, continueAt: e.target.value }))}
                  />
                )}
              </div>
            )}
            <textarea
              className="cm-music-ta"
              value={music.lyrics}
              onChange={(e) => setMusic((m) => ({ ...m, lyrics: e.target.value }))}
              placeholder={
                musicMode === "custom"
                  ? "歌词 · 必填 · Suno 按歌词演唱，支持段落标记\n[Verse]\n阳光洒在肩上\n[Chorus]\n这就是青春的模样"
                  : musicMode === "extend"
                    ? "续写歌词 · 选填 · 留空则由 Suno 续写"
                    : "改编提示 / 歌词 · 选填 · 留空则保留原词"
              }
            />
            <div className="cm-music-row wrap">
              {AUDIO_STYLES.map((s) => {
                const on = music.songStyles.includes(s.v);
                return (
                  <button
                    key={s.v}
                    type="button"
                    className={`cm-tag${on ? " on" : ""}`}
                    onClick={() =>
                      setMusic((m) => ({
                        ...m,
                        songStyles: on
                          ? m.songStyles.filter((x) => x !== s.v)
                          : [...m.songStyles, s.v],
                      }))
                    }
                  >
                    {s.l}
                  </button>
                );
              })}
              <input
                className="cm-music-in title"
                type="text"
                value={music.songTitle}
                onChange={(e) => setMusic((m) => ({ ...m, songTitle: e.target.value }))}
                placeholder="歌名 · 选填"
              />
            </div>
          </div>
        )}
        <div className="composer-bar">
          <div className="cm-row">
          {webSearchAvail && (
            <button
              className={`cm-chip ${web ? "on" : ""}`}
              type="button"
              onClick={() => setWeb((w) => !w)}
            >
              <svg viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" />
              </svg>
              联网
            </button>
          )}
          {modelNames.length > 0 && (
            <CmSelect
              open={openSel === "model"}
              onToggle={() => toggleSel("model")}
              menuH="选择模型"
              lead={
                <span className="cm-sw sm" style={selSwatch.style}>
                  {selSwatch.glyph}
                </span>
              }
              label={model || "选择模型"}
            >
              {genModels.map((m) => {
                const est = m.config?.estSeconds ?? 0;
                const cost = parseFloat(m.pointCost) || 0;
                const tag = est > 0 ? `~${est}s` : cost > 0 ? `${cost}积分` : typeTag(m.type);
                const desc =
                  m.desc || (m.config?.capabilities?.length ? m.config.capabilities.join(" · ") : "高质量生成");
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={m.name === model}
                    className={`cm-mitem${m.name === model ? " on" : ""}`}
                    onClick={() => {
                      selectModel(m.name);
                      setOpenSel(null);
                    }}
                  >
                    {(() => {
                      const sw = swatchByName.get(m.name) ?? swatchOf(m);
                      return (
                        <span className="cm-sw" style={sw.style}>
                          {sw.glyph}
                        </span>
                      );
                    })()}
                    <span className="nfo">
                      <span className="nm">
                        <span className="nm-t">{m.name}</span>
                        <i>{tag}</i>
                      </span>
                      <span className="ds">{desc}</span>
                    </span>
                    <span className="ck" aria-hidden="true">✓</span>
                  </button>
                );
              })}
            </CmSelect>
          )}

          {modeVals.length > 0 && (
            <CmSelect
              open={openSel === "mode"}
              onToggle={() => toggleSel("mode")}
              menuH="生成方式"
              lead={<span className="cm-ico lead">{isVid ? "▶" : "▦"}</span>}
              label={MODE_LABEL[mode] ?? mode}
            >
              {modeVals.map((v) => (
                <button
                  key={v}
                  type="button"
                  role="menuitemradio"
                  aria-checked={v === mode}
                  className={`cm-mitem${v === mode ? " on" : ""}`}
                  onClick={() => {
                    setMode(v);
                    setOpenSel(null);
                  }}
                >
                  <span className="cm-ico">{isVid ? "▶" : "▦"}</span>
                  <span className="nfo">
                    <span className="nm">{MODE_LABEL[v] ?? v}</span>
                    <span className="ds">{MODE_HINT[v] ?? ""}</span>
                  </span>
                  <span className="ck" aria-hidden="true">✓</span>
                </button>
              ))}
            </CmSelect>
          )}

          {/* 音乐创作模式（对齐创作台：灵感 / 自定义歌词 / 延长 / 翻唱） */}
          {isMusicSel && (
            <CmSelect
              open={openSel === "musicMode"}
              onToggle={() => toggleSel("musicMode")}
              menuH="创作模式"
              lead={<span className="cm-ico lead">♪</span>}
              label={MUSIC_MODES.find((o) => o.v === musicMode)?.l ?? "灵感模式"}
            >
              {MUSIC_MODES.map((o) => (
                <button
                  key={o.v}
                  type="button"
                  role="menuitemradio"
                  aria-checked={o.v === musicMode}
                  className={`cm-mitem${o.v === musicMode ? " on" : ""}`}
                  onClick={() => {
                    setMusic((m) => ({ ...m, musicMode: o.v }));
                    setOpenSel(null);
                  }}
                >
                  <span className="cm-ico">♪</span>
                  <span className="nfo">
                    <span className="nm">{o.l}</span>
                    <span className="ds">{MUSIC_MODE_HINT[o.v] ?? ""}</span>
                  </span>
                  <span className="ck" aria-hidden="true">✓</span>
                </button>
              ))}
            </CmSelect>
          )}

          {/* 人声/纯音乐开关（上游 make_instrumental，各创作模式通吃） */}
          {isMusicSel && (
            <button
              className={`cm-chip ${music.instrumental ? "on" : ""}`}
              type="button"
              title={music.instrumental ? "当前生成纯音乐（无人声）" : "当前生成带人声演唱"}
              onClick={() => setMusic((m) => ({ ...m, instrumental: !m.instrumental }))}
            >
              <svg viewBox="0 0 24 24">
                <path d="M9 18V6l10-2v12" />
                <circle cx="6.5" cy="18" r="2.5" />
                <circle cx="16.5" cy="16" r="2.5" />
              </svg>
              纯音乐
            </button>
          )}

          {ratioOpts.length > 0 && (
            <CmSelect
              open={openSel === "ratio"}
              onToggle={() => toggleSel("ratio")}
              menuH="画面比例"
              lead={<RatioBox ratio={ratio} />}
              label={ratio}
            >
              {ratioOpts.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="menuitemradio"
                  aria-checked={r === ratio}
                  className={`cm-mitem${r === ratio ? " on" : ""}`}
                  onClick={() => {
                    setRatio(r);
                    setOpenSel(null);
                  }}
                >
                  <RatioBox ratio={r} />
                  <span className="nfo">
                    <span className="nm">{r}</span>
                  </span>
                  <span className="ck" aria-hidden="true">✓</span>
                </button>
              ))}
            </CmSelect>
          )}

          {resOpts.length > 0 && (
            <CmSelect
              open={openSel === "res"}
              onToggle={() => toggleSel("res")}
              menuH="分辨率"
              label={res.toUpperCase()}
            >
              {resOpts.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="menuitemradio"
                  aria-checked={r === res}
                  className={`cm-mitem${r === res ? " on" : ""}`}
                  onClick={() => {
                    setRes(r);
                    setOpenSel(null);
                  }}
                >
                  <span className="nfo">
                    <span className="nm">{r.toUpperCase()}</span>
                  </span>
                  <span className="ck" aria-hidden="true">✓</span>
                </button>
              ))}
            </CmSelect>
          )}

          {qualOpts.length > 0 && (
            <CmSelect
              open={openSel === "qual"}
              onToggle={() => toggleSel("qual")}
              menuH="画质"
              label={QUALITY_LABEL[quality] ?? quality}
            >
              {qualOpts.map((q) => (
                <button
                  key={q}
                  type="button"
                  role="menuitemradio"
                  aria-checked={q === quality}
                  className={`cm-mitem${q === quality ? " on" : ""}`}
                  onClick={() => {
                    setQuality(q);
                    setOpenSel(null);
                  }}
                >
                  <span className="nfo">
                    <span className="nm">{QUALITY_LABEL[q] ?? q}</span>
                  </span>
                  <span className="ck" aria-hidden="true">✓</span>
                </button>
              ))}
            </CmSelect>
          )}

          {durOpts.length > 0 && (
            <CmSelect
              open={openSel === "dur"}
              onToggle={() => toggleSel("dur")}
              menuH="时长"
              label={dur}
            >
              {durOpts.map((d) => (
                <button
                  key={d}
                  type="button"
                  role="menuitemradio"
                  aria-checked={d === dur}
                  className={`cm-mitem${d === dur ? " on" : ""}`}
                  onClick={() => {
                    setDur(d);
                    setOpenSel(null);
                  }}
                >
                  <span className="nfo">
                    <span className="nm">{d}</span>
                  </span>
                  <span className="ck" aria-hidden="true">✓</span>
                </button>
              ))}
            </CmSelect>
          )}

          {/* 数量仅图片批量适用（batchCount 只随图片请求发出，与创作台同口径）：
              音频一次即整曲、文本按条对话、视频单段生成 */}
          {selModel?.type === "image" && (
          <CmSelect
            open={openSel === "count"}
            onToggle={() => toggleSel("count")}
            menuH="生成数量"
            right
            label={`⚲ ${batch}`}
          >
            {countOpts.map((c) => (
              <button
                key={c}
                type="button"
                role="menuitemradio"
                aria-checked={c === batch}
                className={`cm-mitem${c === batch ? " on" : ""}`}
                onClick={() => {
                  setBatch(c);
                  setOpenSel(null);
                }}
              >
                <span className="cm-ico">⚲</span>
                <span className="nfo">
                  <span className="nm">{c} 张</span>
                </span>
                <span className="ck" aria-hidden="true">✓</span>
              </button>
            ))}
          </CmSelect>
          )}
          </div>
          <span className="cm-pts">约 {points} 积分</span>
          <button
            className="cm-send"
            aria-label="发送"
            type="button"
            onClick={() => send()}
            disabled={
              busy ||
              (!draft.trim() && !musicNoDraftOk) ||
              (selModel?.type === "text" && !!ctxUsage?.full)
            }
            title={
              busy
                ? "处理中…"
                : selModel?.type === "text" && ctxUsage?.full
                  ? "会话上下文已满，请开启新会话"
                  : !draft.trim() && !musicNoDraftOk
                    ? "先输入内容"
                    : "发送"
            }
          >
            ↑
          </button>
        </div>
      </div>
      <div className="chat-hint">Enter 发送 · Shift+Enter 换行 · 可拖拽 / 粘贴添加参考</div>
    </div>
  );
}
