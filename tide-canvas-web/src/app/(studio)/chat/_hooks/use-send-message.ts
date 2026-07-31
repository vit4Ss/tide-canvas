"use client";

/* ── send pipeline (extracted verbatim from page.tsx) ──────────────────────────
   选图片/视频/音频模型 → aiApi.generate 计费管线 → persistTurn 原子入库整轮；
   文本模型 → streamMessage SSE 流式。乐观气泡 / 回滚 / 送出中暂停轮询、
   activeIdRef 防切对话覆盖等语义全部保持原样。 */

import { useCallback } from "react";
import { chatApi, streamMessage } from "@/lib/chat-api";
import { aiApi } from "@/lib/api";
import { skillApi } from "@/lib/skill-api";
import { toast } from "@/components/shared/toast";
import { buildMusicInput, validateMusicParams, type MusicParams } from "@/lib/music-modes";
import type { StudioModelVO } from "@/lib/market-api";
import type { SkillVO } from "@/types/skill";
import type { ContextUsageVO, ConversationVO, MessageVO } from "@/types/chat";
import { musicTurnSummary, type RefItem, type RefPolicy } from "../_components/chat-utils";

export function useSendMessage({
  draft,
  setDraft,
  busy,
  setBusy,
  setTyping,
  activeId,
  setActiveId,
  setConvos,
  setMsgs,
  loadMessages,
  ensureSession,
  selModel,
  mode,
  ratio,
  res,
  quality,
  dur,
  batch,
  refs,
  refPolicy,
  refOptional,
  clearRefs,
  forceBottom,
  scrollEnd,
  nearBottomRef,
  ctxUsage,
  refreshCtxUsage,
  music,
  isMusicSel,
  musicNoDraftOk,
  skill,
  setStreaming,
  chatAbortRef,
  activeIdRef,
}: {
  draft: string;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  busy: boolean;
  setBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setTyping: React.Dispatch<React.SetStateAction<boolean>>;
  activeId: string | null;
  setActiveId: React.Dispatch<React.SetStateAction<string | null>>;
  setConvos: React.Dispatch<React.SetStateAction<ConversationVO[]>>;
  setMsgs: React.Dispatch<React.SetStateAction<MessageVO[]>>;
  loadMessages: (id: string) => Promise<void>;
  ensureSession: () => Promise<boolean>;
  selModel: StudioModelVO | null;
  mode: string;
  ratio: string;
  res: string;
  quality: string;
  dur: string;
  batch: number;
  refs: RefItem[];
  refPolicy: RefPolicy | undefined;
  refOptional: boolean;
  clearRefs: () => void;
  forceBottom: () => void;
  scrollEnd: () => void;
  nearBottomRef: React.RefObject<boolean>;
  ctxUsage: ContextUsageVO | null;
  refreshCtxUsage: (id: string) => Promise<void>;
  music: MusicParams;
  isMusicSel: boolean;
  musicNoDraftOk: boolean;
  skill: SkillVO | null;
  setStreaming: React.Dispatch<React.SetStateAction<string | null>>;
  chatAbortRef: React.RefObject<AbortController | null>;
  activeIdRef: React.RefObject<string | null>;
}) {
  const send = useCallback(async () => {
    const v = draft.trim();
    if (busy) return;
    // 音乐的自定义/延长/翻唱不强制描述；其余（含灵感模式/音效）仍需文字。
    if (!v && !musicNoDraftOk) return;
    if (isMusicSel) {
      const musicErr = validateMusicParams(v, music);
      if (musicErr) {
        toast.info(musicErr);
        return;
      }
    }

    // text-model sends are blocked once the conversation's context is full
    // (the server enforces the same cap; this just fails fast with guidance).
    if (selModel?.type === "text" && ctxUsage?.full) {
      toast.error("当前会话上下文已达上限，请开启新会话");
      return;
    }

    // reference media (uploaded → hosted urls). A ref-mode requires at least one
    // usable ref and blocks while any is still uploading.
    const refImageUrls = refs.filter((r) => r.kind === "image" && r.url).map((r) => r.url as string);
    const refVideoUrls = refs.filter((r) => r.kind === "video" && r.url).map((r) => r.url as string);
    const refAudioUrls = refs.filter((r) => r.kind === "audio" && r.url).map((r) => r.url as string);
    if (refPolicy) {
      if (refs.some((r) => r.uploading)) {
        toast.info("文件上传中，请稍候");
        return;
      }
      // block on a failed upload so the user doesn't unknowingly send without it.
      if (refs.some((r) => r.failed)) {
        toast.error("有文件上传失败，请移除后重试");
        return;
      }
      // text-model uploads are optional; generation ref-modes require one.
      // omni_ref 的策略允许纯音频参考（音频驱动的视频生成），音频也算数——
      // 否则界面明示「音频已添加、可 @ 引用」，发送却被拦，自相矛盾。
      if (
        !refOptional &&
        refImageUrls.length === 0 &&
        refVideoUrls.length === 0 &&
        refAudioUrls.length === 0
      ) {
        toast.error("当前模式需要先添加参考素材");
        return;
      }
    }

    setBusy(true);
    setDraft("");
    await ensureSession();

    // ensure there is a conversation to send into
    let id = activeId;
    if (!id) {
      const created = await chatApi.createConversation({});
      if (created.success && created.data) {
        id = created.data.id;
        setConvos((prev) => [created.data, ...prev]);
        setActiveId(id);
      } else {
        setBusy(false);
        return;
      }
    }

    // attachments snapshot — TEXT models only. Generation turns persist their
    // references via persistTurn (params.references), so attaching here would make
    // the optimistic bubble flash thumbnails that vanish on reload.
    // 文本模型附件收全部类型（图片给模型做多模态,视频/音频/文档落库展示）
    const attachSnapshot = refOptional
      ? refs.filter((r) => r.url).map((r) => ({ url: r.url as string, kind: r.kind }))
      : [];

    // 用户气泡/落库的提示词：音乐模式描述可留空，兜底一句模式摘要（persistTurn
    // 的 prompt 为必填，气泡也不能是空白）。
    const sendText = v || (isMusicSel ? musicTurnSummary(music) : "");

    // optimistic user bubble
    const optimistic: MessageVO = {
      id: `tmp-${Date.now()}`,
      conversationId: id,
      role: "user",
      contentType: "text",
      content: sendText,
      createTime: new Date().toISOString(),
      ...(attachSnapshot.length ? { params: { attachments: attachSnapshot } } : {}),
    };
    setMsgs((prev) => [...prev, optimistic]);
    setTyping(true);
    forceBottom();

    const bump = (cid: string) =>
      setConvos((prev) => {
        const idx = prev.findIndex((c) => c.id === cid);
        if (idx <= 0) return prev;
        const copy = prev.slice();
        const [c] = copy.splice(idx, 1);
        copy.unshift(c);
        return copy;
      });

    // 选图片/视频/音频模型 → 真实生成（一个 turn，助手消息只指向 task）；文本模型 → 文字对话。
    const wantImage = selModel?.type === "image";
    const wantVideo = selModel?.type === "video";
    const wantAudio = selModel?.type === "audio";

    try {
      if ((wantImage || wantVideo || wantAudio) && selModel) {
        // 技能:只发 skillId,模板由服务端拼到描述前面。客户端先拼好的话,落库的
        // input 会变成「模板+描述」,作品标题和「重新编辑」读到的全是模板开头。
        const genPrompt = v;
        const skillInput =
          skill && skill.outputType === selModel.type ? { skillId: skill.id } : {};
        // 先 submit（计费/配额走既有生成管线）；被拒时尚未持久化任何东西，无孤儿可清。
        // 音频：音乐按四创作模式组装（与创作台同构），音效只发描述。
        const input: Record<string, unknown> = wantAudio
          ? isMusicSel
            ? { ...buildMusicInput(genPrompt, music), ...skillInput }
            : { prompt: genPrompt, ...skillInput }
          : {
              prompt: genPrompt,
              ...skillInput,
              ...(ratio ? { aspectRatio: ratio, aspect_ratio: ratio, ratio } : {}),
              ...(res ? { resolution: res } : {}),
              // 图片：clarity + quality 必须一起发，服务端图片单价查的是
              // [quality][clarity]；缺 quality 会查表落空、退回模型固定价。
              ...(wantImage && res ? { clarity: res } : {}),
              ...(wantImage && quality ? { quality } : {}),
              ...(wantVideo && dur ? { duration: dur } : {}),
            };
        // pick the handler by mode + attached references (P2).
        let handler: string;
        if (wantAudio) {
          handler = "text_to_audio";
        } else if (wantVideo) {
          if (mode === "i2v" && refImageUrls.length) {
            handler = "image_to_video";
            input.sourceImage = refImageUrls[0];
            input.imageList = refImageUrls.slice(0, 1);
          } else if (mode === "keyframe" && refImageUrls.length) {
            handler = "start_end_to_video";
            input.firstFrame = refImageUrls[0];
            input.lastFrame = refImageUrls[1] ?? refImageUrls[0];
          } else if (
            mode === "omni_ref" &&
            (refImageUrls.length || refVideoUrls.length || refAudioUrls.length)
          ) {
            // 纯音频参考也走 reference_to_video（与创作台「全能参考」行为一致）
            handler = "reference_to_video";
            input.references = refImageUrls;
            if (refVideoUrls.length) input.videoReferences = refVideoUrls;
            if (refAudioUrls.length) input.audioReferences = refAudioUrls;
          } else {
            handler = "text_to_video";
          }
        } else if (mode === "i2i" && refImageUrls.length) {
          handler = "image_to_image";
          input.imageList = refImageUrls;
        } else {
          handler = "text_to_image";
        }
        // image handlers loop on batchCount → request N images when 批量 > 1 (not video).
        if (wantImage && batch > 1) input.batchCount = batch;
        const gen = await aiApi.generate({
          handler,
          modelId: selModel.modelKey || selModel.id,
          input,
        });
        if (!gen.success) {
          setMsgs((prev) => prev.filter((m) => m.id !== optimistic.id)); // roll back optimistic
          toast.error(gen.message || "生成请求失败");
          return;
        }
        // 技能使用计数(fire-and-forget,失败不影响链路)
        if (skill && skill.outputType === selModel.type) void skillApi.recordUse(skill.id);
        // 成功 → 原子持久化整个 turn（用户提示词+参数快照 / 助手 taskId）。
        const params: Record<string, unknown> = {
          model: selModel.name,
          modelKey: selModel.modelKey,
          type: selModel.type,
          ...(skill && skill.outputType === selModel.type
            ? { skill: { id: skill.id, title: skill.title } }
            : {}),
          ...(mode ? { mode } : {}),
          ...(ratio ? { ratio } : {}),
          ...(res ? { resolution: res } : {}),
          ...(wantImage && quality ? { quality } : {}),
          ...(wantVideo && dur ? { duration: dur } : {}),
          ...(wantImage && batch > 1 ? { batch } : {}),
          // 音乐参数快照：重新编辑/再次生成时恢复四模式字段。
          ...(wantAudio && isMusicSel ? { music: { ...music } } : {}),
          ...(refImageUrls.length || refVideoUrls.length || refAudioUrls.length
            ? {
                references: [
                  ...refImageUrls.map((url) => ({ url, kind: "image" })),
                  ...refVideoUrls.map((url) => ({ url, kind: "video" })),
                  // 音频引用也要入快照：漏掉的话「重新编辑/再次生成」恢复不出
                  // 音频素材，prompt 里的「音频N」token 变成悬空引用
                  ...refAudioUrls.map((url) => ({ url, kind: "audio" })),
                ],
              }
            : {}),
        };
        await chatApi.persistTurn(id, {
          prompt: sendText,
          params,
          taskId: gen.data.id,
          contentType: wantVideo ? "video" : wantAudio ? "audio" : "image",
        });
        clearRefs(); // turn committed → clear the composer references
        // only reload into the view if still on this conversation; otherwise the
        // turn is already persisted and will show when the user switches back.
        if (activeIdRef.current === id) await loadMessages(id);
        bump(id); // surface the conversation to the top regardless of focus
        refreshCtxUsage(id); // generation prompts count toward the context cap too
      } else {
        // text model → streamed reply (P4). The generic typing dots give way to
        // a live streaming bubble; switching conversation aborts it.
        setTyping(false);
        setStreaming("");
        const ac = new AbortController();
        chatAbortRef.current = ac;
        let acc = "";
        let streamOk = true;
        await streamMessage(id, v, {
          signal: ac.signal,
          attachments: attachSnapshot,
          // route the reply to the composer's selected text model (server
          // validates against 模型管理 and falls back to the primary otherwise)
          model: selModel?.type === "text" ? selModel.modelKey : undefined,
          onDelta: (d) => {
            acc += d;
            setStreaming(acc);
            // coalesce rapid tokens into one scroll per frame to avoid judder.
            if (nearBottomRef.current) requestAnimationFrame(scrollEnd);
          },
          onError: (m, code) => {
            streamOk = false;
            toast.error(m || "生成失败");
            // context cap reached server-side → refresh so the 开启新会话 bar shows.
            if (code === "CONTEXT_LIMIT") refreshCtxUsage(id);
          },
        });
        // clear the attachment strip only on success — keep it on failure so the
        // user can resend without re-picking the files.
        if (streamOk) clearRefs();
        // only clear OUR controller — a newer stream may have replaced it.
        if (chatAbortRef.current === ac) chatAbortRef.current = null;
        setStreaming(null);
        // only refresh if the user is still on this conversation (not switched away).
        if (activeIdRef.current === id) {
          await loadMessages(id);
          bump(id);
        }
        if (streamOk) refreshCtxUsage(id);
        // On stream failure, restore the typed text to the composer. The draft was
        // cleared up-front and loadMessages above dropped the optimistic bubble; on a
        // network failure nothing was persisted, so without this the message is lost
        // with no way to resend. Don't clobber newer text the user already typed.
        if (!streamOk) {
          setDraft((cur) => (cur ? cur : v));
        }
      }
    } finally {
      setTyping(false);
      setBusy(false);
    }
  }, [draft, busy, activeId, ensureSession, loadMessages, selModel, mode, ratio, res, quality, dur, batch, refs, refPolicy, refOptional, clearRefs, forceBottom, scrollEnd, ctxUsage, refreshCtxUsage, music, isMusicSel, musicNoDraftOk, skill, activeIdRef, chatAbortRef, nearBottomRef, setActiveId, setBusy, setConvos, setDraft, setMsgs, setStreaming, setTyping]);

  return send;
}
