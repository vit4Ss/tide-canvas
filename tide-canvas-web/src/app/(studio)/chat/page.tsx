"use client";

/* ============================================================================
   /chat — 对话式生成 (Chat) page.

   Ported from design-ref/对话.html + design-ref/liuguang/chat.js. Renders ONLY
   the content to the right of the (studio) ws-rail (the rail, dark flux bg, and
   flux/pages/studio.css all come from the (studio) layout). This page imports
   chat.css itself (the (studio) layout does not).

   Data is REAL and fully authed: chatApi over /api/im/* (see src/lib/chat-api.ts).
   ensureSession() runs before the first request. The conversation list comes
   from chatApi.conversations(); selecting one loads chatApi.messages(). 文本模型
   走 streamMessage（SSE 流式，完成后 reload 落库消息）；图/视频模型先经
   aiApi.generate 跑任务，再 persistTurn 原子入库整轮。「新对话」 creates a
   conversation via createConversation().

   The composer chips (联网 / 模式 / 模型 / 比例 / 分辨率 / 时长 / 批量 / 积分) are
   driven by the selected model's 模型管理 config, and the 比例/分辨率/时长/批量
   selections ARE wired into aiApi.generate (aspectRatio/resolution/duration/
   batchCount). 联网 only renders for a 文本 model whose config.webSearch is enabled.

   Structure (route-private, underscore dirs are not routed):
     _components/  chat-utils(常量·类型·纯函数) cm-select lightbox ref-thumb
                   message-bubble conversation-sidebar chat-thread composer
                   reference-popovers
     _hooks/       use-gen-models use-composer-config use-references use-streaming
                   use-conversations use-context-usage use-auto-scroll
                   use-send-message use-turn-actions use-task-polling use-resume-stream
   This file is pure composition: hook wiring + JSX 拼装，无业务逻辑。
   ========================================================================== */

import "@/styles/liuguang/chat.css";

import { useCallback, useMemo, useRef, useState } from "react";
import { useAuthStore } from "@/stores/use-auth-store";
import { SkillPicker } from "@/components/skill/skill-picker";
import { promptAfterSkillPick } from "@/lib/skill-prompt";
import type { SkillRunPanelActionPayload } from "@/components/skill/skill-run-panel";
import { toast } from "@/components/shared/toast";
import type { MentionEditorHandle } from "@/components/studio/mention-prompt-editor";
import { skillRunApi } from "@/lib/skill-run-api";
import type { SkillRunAction } from "@/types/skill-run";
import { type LightboxItem } from "./_components/chat-utils";
import { Lightbox } from "./_components/lightbox";
import { ConversationSidebar } from "./_components/conversation-sidebar";
import { ChatThread } from "./_components/chat-thread";
import { Composer } from "./_components/composer";
import { AssetPickerDialog, SourceMenu } from "./_components/reference-popovers";
import { useGenModels } from "./_hooks/use-gen-models";
import { useComposerConfig } from "./_hooks/use-composer-config";
import { useReferences } from "./_hooks/use-references";
import { useStreaming } from "./_hooks/use-streaming";
import { useConversations } from "./_hooks/use-conversations";
import { useContextUsage } from "./_hooks/use-context-usage";
import { useAutoScroll } from "./_hooks/use-auto-scroll";
import { useSendMessage } from "./_hooks/use-send-message";
import { useTurnActions } from "./_hooks/use-turn-actions";
import { useTaskPolling } from "./_hooks/use-task-polling";
import { useResumeStream } from "./_hooks/use-resume-stream";

/* ── component ────────────────────────────────────────────────────────────── */

export default function ChatPage() {
  const ensureSession = useAuthStore((s) => s.ensureSession);

  // cross-cutting state shared by several hooks (送出态 / 输入草稿 / typing 圆点)
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [textRecovering, setTextRecovering] = useState(false);
  const [typing, setTyping] = useState(false);

  const models = useGenModels();
  const cfg = useComposerConfig(models);
  const refsApi = useReferences({ refPolicy: cfg.refPolicy });
  const streamingApi = useStreaming();
  const conv = useConversations({
    ensureSession,
    busy: busy || textRecovering,
    setBusy,
    setDraft,
    stopStream: streamingApi.stopStream,
    clearRefs: refsApi.clearRefs,
  });
  const { ctxUsage, refreshCtxUsage } = useContextUsage(conv.activeId);
  const scroll = useAutoScroll({ msgs: conv.msgs, typing, activeId: conv.activeId });

  const taRef = useRef<MentionEditorHandle>(null);

  const send = useSendMessage({
    draft,
    setDraft,
    busy,
    setBusy,
    setTyping,
    activeId: conv.activeId,
    setActiveId: conv.setActiveId,
    setConvos: conv.setConvos,
    setMsgs: conv.setMsgs,
    loadMessages: conv.loadMessages,
    ensureSession,
    selModel: models.selModel,
    mode: cfg.mode,
    ratio: cfg.ratio,
    res: cfg.res,
    quality: cfg.quality,
    dur: cfg.dur,
    batch: cfg.batch,
    refs: refsApi.refs,
    refPolicy: cfg.refPolicy,
    refOptional: cfg.refOptional,
    clearRefsIfUnchanged: refsApi.clearRefsIfUnchanged,
    restoreRefsIfEmpty: refsApi.restoreRefsIfEmpty,
    forceBottom: scroll.forceBottom,
    scrollEnd: scroll.scrollEnd,
    nearBottomRef: scroll.nearBottomRef,
    ctxUsage,
    refreshCtxUsage,
    music: cfg.music,
    isMusicSel: cfg.isMusicSel,
    musicNoDraftOk: cfg.musicNoDraftOk,
    skill: cfg.skill,
    setStreaming: streamingApi.setStreaming,
    chatAbortRef: streamingApi.chatAbortRef,
    activeIdRef: conv.activeIdRef,
    textRecovering,
    setTextRecovering,
  });

  const { reEdit, regenerate, restoringTurn } = useTurnActions({
    msgs: conv.msgs,
    busy: busy || textRecovering,
    activeId: conv.activeId,
    genModels: models.genModels,
    send,
    setModel: models.setModel,
    setMode: cfg.setMode,
    setRatio: cfg.setRatio,
    setRes: cfg.setRes,
    setQuality: cfg.setQuality,
    setDur: cfg.setDur,
    setBatch: cfg.setBatch,
    setMusic: cfg.setMusic,
    setSkill: cfg.setSkill,
    restoreRefs: refsApi.restoreRefs,
    setDraft,
    taRef,
  });

  useTaskPolling({ msgs: conv.msgs, activeId: conv.activeId, busy, loadMessages: conv.loadMessages });
  useResumeStream({
    msgs: conv.msgs,
    activeId: conv.activeId,
    busy,
    setMsgs: conv.setMsgs,
    setStreaming: streamingApi.setStreaming,
    nearBottomRef: scroll.nearBottomRef,
    scrollEnd: scroll.scrollEnd,
    refreshCtxUsage,
  });

  // lightbox (P5): viewed media set + index.
  const [lightbox, setLightbox] = useState<{ items: LightboxItem[]; index: number } | null>(null);
  const openLightbox = useCallback(
    (items: LightboxItem[], index: number) => setLightbox({ items, index }),
    [],
  );
  const stepLightbox = useCallback(
    (delta: number) =>
      setLightbox((lb) =>
        lb ? { ...lb, index: (lb.index + delta + lb.items.length) % lb.items.length } : lb,
      ),
    [],
  );
  const activeConversationId = conv.activeId;
  const loadConversationMessages = conv.loadMessages;

  const handleSkillRunAction = useCallback(
    async (
      runId: string,
      action: SkillRunAction,
      payload?: SkillRunPanelActionPayload,
      expectedRevision?: number,
    ) => {
      if (expectedRevision === undefined) {
        toast.error("技能状态尚未同步，请刷新后重试");
        return;
      }
      const conversationId = activeConversationId;
      await ensureSession();
      const result = await skillRunApi.actionIdempotent(runId, {
        action,
        expectedRevision,
        ...(payload?.feedback ? { feedback: payload.feedback } : {}),
        ...(payload?.input ? { input: payload.input } : {}),
        clientRequestId:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `chat-action-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      }, `action:chat:${activeConversationId || "unknown"}:${runId}`);
      if (!result.success) {
        toast.error(result.message || "技能操作失败，请重试");
        return;
      }
      if (conversationId && conv.activeIdRef.current === conversationId) {
        await loadConversationMessages(conversationId);
      }
    },
    [activeConversationId, conv.activeIdRef, ensureSession, loadConversationMessages],
  );

  // 当前所选模型的头像（发送占位/流式回复/文字回复的 AI 头像都用它，
  // 让"正在生成"的气泡直接亮出当前模型的图标而不是通用 ✦）。
  const curModelAv = (
    <span className="av av-model" style={models.selSwatch.style} title={models.model}>
      {models.selSwatch.glyph}
    </span>
  );
  // 生成结果的兜底模型名：旧任务没存 modelName 时，回退到该轮用户消息的
  // params.model（persistTurn 的参数快照）。按消息顺序一次扫描建表。
  const fallbackModelByMsg = useMemo(() => {
    const map = new Map<string, string>();
    let lastParamModel = "";
    for (const m of conv.msgs) {
      if (m.role === "user") {
        const pm = m.params && typeof m.params.model === "string" ? (m.params.model as string) : "";
        if (pm) lastParamModel = pm;
      } else if (m.taskId) {
        map.set(m.id, lastParamModel);
      }
    }
    return map;
  }, [conv.msgs]);

  return (
    <div
      className="chat-wrap"
      inert={restoringTurn ? true : undefined}
      aria-busy={restoringTurn}
    >
      {/* conversation list */}
      <ConversationSidebar
        convos={conv.convos}
        convosLoading={conv.convosLoading}
        activeId={conv.activeId}
        busy={busy}
        renamingId={conv.renamingId}
        renameVal={conv.renameVal}
        onNewChat={conv.newChat}
        onPick={conv.pickConvo}
        onStartRename={conv.startRename}
        onRenameChange={conv.setRenameVal}
        onCommitRename={conv.commitRename}
        onCancelRename={() => conv.setRenamingId(null)}
        onRemove={conv.removeConvo}
      />

      {/* chat main */}
      <main className="chat-main">
        <div className="chat-top">
          <span className="ti">{conv.activeTitle}</span>
        </div>

        <ChatThread
          threadRef={scroll.threadRef}
          onThreadScroll={scroll.onThreadScroll}
          msgsLoading={conv.msgsLoading}
          msgs={conv.msgs}
          avatar={curModelAv}
          onReEdit={reEdit}
          onRegenerate={regenerate}
          onOpenLightbox={openLightbox}
          onSkillRunAction={handleSkillRunAction}
          swatchFor={models.swatchForName}
          fallbackModelByMsg={fallbackModelByMsg}
          curModelName={models.model}
          streaming={streamingApi.streaming}
          typing={typing}
          showJump={scroll.showJump}
          onJumpToLatest={scroll.forceBottom}
        />

        <Composer
          models={models}
          cfg={cfg}
          refsApi={refsApi}
          draft={draft}
          setDraft={setDraft}
          taRef={taRef}
          send={send}
          busy={busy || textRecovering || restoringTurn}
          ctxUsage={ctxUsage}
          newChat={conv.newChat}
          openLightbox={openLightbox}
        />
      </main>

      {lightbox && (
        <Lightbox
          items={lightbox.items}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
          onStep={stepLightbox}
        />
      )}

      {/* 参考素材来源选择：本地上传 / 资产库（复用 创作台 的来源菜单） */}
      {refsApi.srcMenuPos && !!cfg.refPolicy?.kinds.length && (
        <SourceMenu
          pos={refsApi.srcMenuPos}
          menuRef={refsApi.srcMenuElRef}
          onClose={() => refsApi.setSrcMenuPos(null)}
          onPickLocal={refsApi.pickLocal}
          onOpenAssets={refsApi.openAssets}
        />
      )}

      {/* 技能广场:按当前模型模态过滤 */}
      <SkillPicker
        open={cfg.skillPickerOpen}
        onClose={() => cfg.setSkillPickerOpen(false)}
        onPick={(nextSkill) => {
          setDraft((current) => promptAfterSkillPick(current, nextSkill, cfg.skill));
          cfg.pickSkill(nextSkill);
        }}
        kinds={["preset"]}
        entryPoint="chat"
        outputType={models.selModel?.type}
        targetType={models.selModel?.type ?? "text"}
        currentId={cfg.skill?.id}
      />

      {/* 资产库弹窗：复用整个资产页 UI 作为选择器 */}
      {refsApi.assetPickOpen && !!cfg.refPolicy?.kinds.length && (
        <AssetPickerDialog
          key={cfg.refPolicy?.kinds.join(",") || "none"}
          refPolicy={cfg.refPolicy}
          onClose={() => refsApi.setAssetPickOpen(false)}
          onPick={refsApi.chooseAsset}
        />
      )}
    </div>
  );
}
