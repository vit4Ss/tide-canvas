"use client";

/* ── turn actions: 重新编辑 / 再次生成 / 重试 (extracted verbatim from page.tsx) ─
   从该轮用户消息的 params 快照还原 composer 参数；再次生成在快照提交后闩发 send。 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "@/components/shared/toast";
import { DEFAULT_MUSIC_PARAMS, type MusicParams } from "@/lib/music-modes";
import { skillApi } from "@/lib/skill-api";
import type { StudioModelVO } from "@/lib/market-api";
import type { MessageVO } from "@/types/chat";
import {
  skillKindOf,
  skillSupportsEntryPoint,
  skillSupportsOutput,
  type SkillVO,
} from "@/types/skill";
import type { MentionEditorHandle } from "@/components/studio/mention-prompt-editor";
import type { HistorySendTarget } from "./history-send-target";
import { historicalModelOf } from "./history-model";

function withHistoryRestoreTimeout<T>(promise: Promise<T>, timeoutMs = 15_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("history restore timeout")), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function storedSkillOf(p?: Record<string, unknown>): { id: string; title: string } | null {
  if (!p) return null;
  const raw = p.skill;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const value = raw as Record<string, unknown>;
    if (typeof value.id === "string" && value.id) {
      return {
        id: value.id,
        title: typeof value.title === "string" ? value.title : "原技能",
      };
    }
  }
  // 兼容迁移期间可能保存过的扁平字段。
  if (typeof p.skillId === "string" && p.skillId) {
    return {
      id: p.skillId,
      title: typeof p.skillName === "string" ? p.skillName : "原技能",
    };
  }
  return null;
}

export function useTurnActions({
  msgs,
  busy,
  activeId,
  genModels,
  send,
  setModel,
  setMode,
  setRatio,
  setRes,
  setQuality,
  setDur,
  setBatch,
  setMusic,
  setSkill,
  restoreRefs,
  setDraft,
  taRef,
}: {
  msgs: MessageVO[];
  busy: boolean;
  activeId: string | null;
  genModels: StudioModelVO[];
  send: (expected?: HistorySendTarget) => Promise<void>;
  setModel: React.Dispatch<React.SetStateAction<string>>;
  setMode: React.Dispatch<React.SetStateAction<string>>;
  setRatio: React.Dispatch<React.SetStateAction<string>>;
  setRes: React.Dispatch<React.SetStateAction<string>>;
  setQuality: React.Dispatch<React.SetStateAction<string>>;
  setDur: React.Dispatch<React.SetStateAction<string>>;
  setBatch: React.Dispatch<React.SetStateAction<number>>;
  setMusic: React.Dispatch<React.SetStateAction<MusicParams>>;
  setSkill: React.Dispatch<React.SetStateAction<SkillVO | null>>;
  restoreRefs: (raw: unknown) => void;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  taRef: React.RefObject<MentionEditorHandle | null>;
}) {
  // 防止连续点击两条历史消息时，较慢的前一次技能查询反向覆盖后一次恢复。
  const restoreSeqRef = useRef(0);
  const historyActionLockRef = useRef(false);
  const [restoringTurn, setRestoringTurn] = useState(false);
  // Async skill validation must use the catalog that is current when it
  // resolves, not the render snapshot from when the history button was clicked.
  const genModelsRef = useRef(genModels);
  const msgsRef = useRef(msgs);
  useLayoutEffect(() => {
    genModelsRef.current = genModels;
  }, [genModels]);
  useLayoutEffect(() => {
    msgsRef.current = msgs;
  }, [msgs]);

  // restore a turn's snapshot params into the composer (重新编辑 / 再次生成).
  const restoreFromParams = useCallback(
    (p?: Record<string, unknown>) => {
      // 无技能的历史轮次也必须显式清空当前技能，不能把当前 chip 静默套用过去。
      setSkill(null);
      if (!p) {
        restoreRefs(undefined);
        return;
      }
      if (typeof p.mode === "string") setMode(p.mode);
      if (typeof p.ratio === "string") setRatio(p.ratio);
      if (typeof p.resolution === "string") setRes(p.resolution);
      if (typeof p.quality === "string") setQuality(p.quality);
      if (typeof p.duration === "string") setDur(p.duration);
      if (typeof p.batch === "number") setBatch(p.batch);
      // 音乐参数：有快照按快照恢复，没有则回到默认（避免把上一轮的歌词/原曲
      // 带进一个非音乐 turn 的重新编辑）。
      setMusic(
        p.music && typeof p.music === "object"
          ? { ...DEFAULT_MUSIC_PARAMS, ...(p.music as Partial<MusicParams>) }
          : DEFAULT_MUSIC_PARAMS,
      );
      // Restore both generation references and normal text-chat attachments.
      // They share the same URL-only composer shape; text turns persist them as
      // `attachments`, while media turns use `references`.
      restoreRefs(Array.isArray(p.references) ? p.references : p.attachments);
    },
    [restoreRefs, setMode, setRatio, setRes, setQuality, setDur, setBatch, setMusic, setSkill],
  );

  const restoreSkillFromParams = useCallback(async (
    p: Record<string, unknown> | undefined,
    seq: number,
    modelRowId?: string,
  ): Promise<{ ok: boolean; model?: StudioModelVO; skillId?: string }> => {
    const saved = storedSkillOf(p);
    let availableModels = genModelsRef.current;
    let savedModel = historicalModelOf(p, availableModels, modelRowId);
    const requestedOutputType = typeof p?.type === "string" ? p.type : savedModel?.type;
    if (!saved) {
      if (!savedModel) {
        // Plain text-chat turns historically persisted only attachments and no
        // model snapshot. They are still editable with the current text model;
        // do not report a misleading "historical model unavailable" warning.
        if (!p?.modelRowId && !p?.modelKey && !p?.model && !modelRowId) {
          return { ok: true };
        }
        const label = typeof p?.model === "string" ? p.model : "原模型";
        toast.info(`历史模型「${label}」已下架，已保留当前模型，请确认后手动发送`);
        return { ok: false };
      }
      setModel(savedModel.name);
      return { ok: true, model: savedModel };
    }
    const result = await withHistoryRestoreTimeout(skillApi.get(saved.id, "chat", requestedOutputType));
    if (seq !== restoreSeqRef.current) return { ok: false };
    // Focus/visibility reloads may replace the catalog while the Skill request
    // is in flight. Validate against the list current at resolution time.
    availableModels = genModelsRef.current;
    savedModel = historicalModelOf(p, availableModels, modelRowId);
    const outputType = typeof p?.type === "string" ? p.type : savedModel?.type;
    const restored = result.success ? result.data : undefined;
    if (
      !restored
      || restored.status !== 1
      || skillKindOf(restored) !== "preset"
      || !skillSupportsEntryPoint(restored, "chat")
      || !skillSupportsOutput(restored, outputType)
    ) {
      toast.info(`技能「${saved.title}」当前不可用，已移除，请重新选择后发送`);
      return { ok: false };
    }
    let fixedModel: StudioModelVO | undefined;
    if (restored.modelId) {
      fixedModel = availableModels.find((candidate) =>
        candidate.modelKey === restored.modelId
        && (!outputType || candidate.type === outputType),
      );
      if (!fixedModel) {
        toast.info(`技能「${restored.title || saved.title}」关联的模型已下架，请重新选择技能`);
        return { ok: false };
      }
      setModel(fixedModel.name);
    } else if (!savedModel) {
      const label = typeof p?.model === "string" ? p.model : "原模型";
      toast.info(`历史模型「${label}」已下架，已保留当前模型，请确认后手动发送`);
      return { ok: false };
    } else {
      setModel(savedModel.name);
    }
    setSkill(restored);
    return { ok: true, model: fixedModel || savedModel, skillId: restored.id };
  }, [setModel, setSkill]);

  // Resolve the user prompt for a turn. Re-edit can be triggered from either
  // an assistant result or the user bubble itself.
  const turnUserOf = useCallback(
    (aiMsg: MessageVO): MessageVO | null => {
      const idx = msgs.findIndex((m) => m.id === aiMsg.id);
      if (msgs[idx]?.role === "user") return msgs[idx];
      for (let i = idx - 1; i >= 0; i--) if (msgs[i].role === "user") return msgs[i];
      return null;
    },
    [msgs],
  );

  const reEdit = useCallback(
    async (aiMsg: MessageVO) => {
      if (busy || historyActionLockRef.current) return;
      const u = turnUserOf(aiMsg);
      if (!u) return;
      historyActionLockRef.current = true;
      setRestoringTurn(true);
      const seq = ++restoreSeqRef.current;
      restoreFromParams(u.params);
      setDraft(u.content);
      try {
        await restoreSkillFromParams(u.params, seq, aiMsg.task?.modelId);
      } catch {
        if (seq === restoreSeqRef.current) toast.info("历史参数暂时无法恢复，请稍后重试");
      } finally {
        if (seq === restoreSeqRef.current) {
          historyActionLockRef.current = false;
          setRestoringTurn(false);
          // If the conversation changed through an external navigation while
          // validation was in flight, do not focus or act on the stale turn.
          const stillCurrent = msgsRef.current.some((message) => message.id === aiMsg.id)
            && msgsRef.current.some((message) => message.id === u.id);
          if (stillCurrent) requestAnimationFrame(() => taRef.current?.focus());
        }
      }
    },
    [busy, turnUserOf, restoreFromParams, restoreSkillFromParams, setDraft, taRef],
  );

  const [pendingSend, setPendingSend] = useState<HistorySendTarget | null>(null);
  const regenerate = useCallback(
    async (aiMsg: MessageVO) => {
      if (busy || historyActionLockRef.current) return;
      if (!activeId) return;
      const u = turnUserOf(aiMsg);
      if (!u) return;
      historyActionLockRef.current = true;
      setRestoringTurn(true);
      const seq = ++restoreSeqRef.current;
      restoreFromParams(u.params);
      setDraft(u.content);
      let queued = false;
      try {
        const restoredSkill = await restoreSkillFromParams(u.params, seq, aiMsg.task?.modelId);
        const stillCurrent = msgsRef.current.some((message) => message.id === aiMsg.id)
          && msgsRef.current.some((message) => message.id === u.id);
        if (seq !== restoreSeqRef.current || !stillCurrent || !restoredSkill.ok) return;
        if (!restoredSkill.model) {
          toast.info("历史模型当前不可用，请重新选择模型后发送");
          requestAnimationFrame(() => taRef.current?.focus());
          return;
        }
        queued = true;
        setPendingSend({
          conversationId: activeId,
          draft: u.content,
          model: {
            id: restoredSkill.model.id,
            name: restoredSkill.model.name,
            modelKey: restoredSkill.model.modelKey,
            type: restoredSkill.model.type,
          },
          skillId: restoredSkill.skillId || null,
        });
      } catch {
        if (seq === restoreSeqRef.current) toast.info("历史参数暂时无法恢复，请稍后重试");
      } finally {
        if (!queued && seq === restoreSeqRef.current) {
          historyActionLockRef.current = false;
          setRestoringTurn(false);
        }
      }
    },
    [activeId, busy, turnUserOf, restoreFromParams, restoreSkillFromParams, setDraft, taRef],
  );
  // fire send() once the restored params/draft have committed.
  useEffect(() => {
    if (!pendingSend) return;
    const target = pendingSend;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 一次性触发闩：复位后立即发送，不产生级联
    setPendingSend(null);
    historyActionLockRef.current = false;
    setRestoringTurn(false);
    void send(target);
  }, [pendingSend, send]);

  return { reEdit, regenerate, restoringTurn };
}
