"use client";

/* ── turn actions: 重新编辑 / 再次生成 / 重试 (extracted verbatim from page.tsx) ─
   从该轮用户消息的 params 快照还原 composer 参数；再次生成在快照提交后闩发 send。 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "@/components/shared/toast";
import { DEFAULT_MUSIC_PARAMS, type MusicParams } from "@/lib/music-modes";
import type { StudioModelVO } from "@/lib/market-api";
import type { MessageVO } from "@/types/chat";
import type { MentionEditorHandle } from "@/components/studio/mention-prompt-editor";

export function useTurnActions({
  msgs,
  busy,
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
  restoreRefs,
  setDraft,
  taRef,
}: {
  msgs: MessageVO[];
  busy: boolean;
  genModels: StudioModelVO[];
  send: () => Promise<void>;
  setModel: React.Dispatch<React.SetStateAction<string>>;
  setMode: React.Dispatch<React.SetStateAction<string>>;
  setRatio: React.Dispatch<React.SetStateAction<string>>;
  setRes: React.Dispatch<React.SetStateAction<string>>;
  setQuality: React.Dispatch<React.SetStateAction<string>>;
  setDur: React.Dispatch<React.SetStateAction<string>>;
  setBatch: React.Dispatch<React.SetStateAction<number>>;
  setMusic: React.Dispatch<React.SetStateAction<MusicParams>>;
  restoreRefs: (raw: unknown) => void;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  taRef: React.RefObject<MentionEditorHandle | null>;
}) {
  // restore a turn's snapshot params into the composer (重新编辑 / 再次生成).
  const restoreFromParams = useCallback(
    (p?: Record<string, unknown>) => {
      if (!p) return;
      if (typeof p.model === "string") setModel(p.model);
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
      // restore reference media as url-only items (the originals are hosted; no
      // local blob/file is recreated). Lets 再次生成 work on a reference turn.
      restoreRefs(p.references);
    },
    [restoreRefs, setModel, setMode, setRatio, setRes, setQuality, setDur, setBatch, setMusic],
  );

  // find the user (prompt) message of the turn an assistant result belongs to.
  const turnUserOf = useCallback(
    (aiMsg: MessageVO): MessageVO | null => {
      const idx = msgs.findIndex((m) => m.id === aiMsg.id);
      for (let i = idx - 1; i >= 0; i--) if (msgs[i].role === "user") return msgs[i];
      return null;
    },
    [msgs],
  );

  const reEdit = useCallback(
    (aiMsg: MessageVO) => {
      const u = turnUserOf(aiMsg);
      if (!u) return;
      restoreFromParams(u.params);
      setDraft(u.content);
      requestAnimationFrame(() => taRef.current?.focus());
    },
    [turnUserOf, restoreFromParams, setDraft, taRef],
  );

  const [pendingSend, setPendingSend] = useState(false);
  const regenerate = useCallback(
    (aiMsg: MessageVO) => {
      if (busy) return;
      const u = turnUserOf(aiMsg);
      if (!u) return;
      // 快照里的模型已下架时不能自动发送：selModel 会解析为 null，send() 将
      // 静默降级成文本对话（图片提示词喂给文本模型，还白吃上下文）。回填
      // 参数与提示词让用户改选模型后手动发送。
      const pm = u.params && typeof u.params.model === "string" ? (u.params.model as string) : "";
      const modelGone = !!pm && !genModels.some((m) => m.name === pm);
      restoreFromParams(u.params);
      setDraft(u.content);
      if (modelGone) {
        toast.info(`模型「${pm}」已下架，请重新选择模型后发送`);
        requestAnimationFrame(() => taRef.current?.focus());
        return;
      }
      setPendingSend(true);
    },
    [busy, turnUserOf, restoreFromParams, genModels, setDraft, taRef],
  );
  // fire send() once the restored params/draft have committed.
  useEffect(() => {
    if (!pendingSend) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 一次性触发闩：复位后立即发送，不产生级联
    setPendingSend(false);
    send();
  }, [pendingSend, send]);

  return { reEdit, regenerate };
}
