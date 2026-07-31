"use client";

/* ── conversation list + message thread state (extracted verbatim from page.tsx) ─
   对话即历史：列表加载 / 切换 / 新建 / 重命名 / 删除，消息加载带请求序号防竞态，
   activeIdRef 镜像供 send/resume 在异步回调里防切对话覆盖。 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { chatApi } from "@/lib/chat-api";
import { toast } from "@/components/shared/toast";
import { confirmDialog } from "@/components/shared/confirm";
import type { ConversationVO, MessageVO } from "@/types/chat";

export function useConversations({
  ensureSession,
  busy,
  setBusy,
  setDraft,
  stopStream,
  clearRefs,
}: {
  ensureSession: () => Promise<boolean>;
  busy: boolean;
  setBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  stopStream: () => void;
  clearRefs: () => void;
}) {
  const [convos, setConvos] = useState<ConversationVO[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<MessageVO[]>([]);
  const [convosLoading, setConvosLoading] = useState(true);
  const [msgsLoading, setMsgsLoading] = useState(false);

  // 渲染期镜像：send / resume 的异步回调用它确认「仍停在该对话」。
  const activeIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  // bumps on every message-load request so a stale response (from a conversation
  // the user already switched away from, or an old poll) is discarded instead of
  // overwriting the current thread.
  const msgsReqRef = useRef(0);

  // load a conversation's message history
  const loadMessages = useCallback(async (id: string) => {
    const myReq = ++msgsReqRef.current;
    setMsgsLoading(true);
    try {
      const res = await chatApi.messages(id, { pageNum: 1, pageSize: 100 });
      if (myReq !== msgsReqRef.current) return; // superseded by a newer load/switch
      if (res.success && res.data) setMsgs(res.data.records);
      else setMsgs([]);
    } finally {
      if (myReq === msgsReqRef.current) setMsgsLoading(false);
    }
  }, []);

  // initial load: session → conversation list → select the first one
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await ensureSession();
        const res = await chatApi.conversations({ pageNum: 1, pageSize: 50 });
        if (cancelled) return;
        if (res.success && res.data) {
          setConvos(res.data.records);
          const first = res.data.records[0];
          if (first) {
            setActiveId(first.id);
            await loadMessages(first.id);
          }
        }
      } finally {
        if (!cancelled) setConvosLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ensureSession, loadMessages]);

  const pickConvo = useCallback(
    (id: string) => {
      if (id === activeId) return;
      stopStream();
      setActiveId(id);
      setMsgs([]); // clear the old thread so the switch never shows stale messages
      clearRefs();
      loadMessages(id);
    },
    [activeId, loadMessages, clearRefs, stopStream],
  );

  const newChat = useCallback(async () => {
    if (busy) return;
    stopStream();
    setBusy(true);
    try {
      await ensureSession();
      const res = await chatApi.createConversation({});
      if (res.success && res.data) {
        setConvos((prev) => [res.data, ...prev]);
        setActiveId(res.data.id);
        setMsgs([]);
        setDraft("");
        clearRefs();
      }
    } finally {
      setBusy(false);
    }
  }, [busy, ensureSession, clearRefs, stopStream, setBusy, setDraft]);

  // conversation rename / delete (P5)
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");

  const startRename = useCallback((c: ConversationVO) => {
    setRenamingId(c.id);
    setRenameVal(c.title || "");
  }, []);

  const commitRename = useCallback(async () => {
    const id = renamingId;
    if (!id) return;
    setRenamingId(null);
    const title = renameVal.trim();
    const cur = convos.find((c) => c.id === id);
    if (!cur || !title || title === cur.title) return;
    setConvos((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c))); // optimistic
    const res = await chatApi.renameConversation(id, title);
    if (!res.success) {
      setConvos((prev) => prev.map((c) => (c.id === id ? { ...c, title: cur.title } : c))); // revert
      toast.error(res.message || "重命名失败");
    }
  }, [renamingId, renameVal, convos]);

  const removeConvo = useCallback(
    async (c: ConversationVO) => {
      if (
        !(await confirmDialog({
          title: "删除对话",
          message: `删除对话「${c.title || "未命名对话"}」？此操作不可撤销。`,
          confirmText: "删除",
        }))
      )
        return;
      const res = await chatApi.deleteConversation(c.id);
      if (!res.success) {
        toast.error(res.message || "删除失败");
        return;
      }
      const remaining = convos.filter((x) => x.id !== c.id);
      setConvos(remaining);
      if (activeId === c.id) {
        // 删除的是当前会话：先停掉进行中的流（删除按钮没有 busy 守卫，流式
        // 期间可点），否则幽灵流式气泡会渗进切换后的会话继续打字。
        stopStream();
        if (remaining[0]) {
          setActiveId(remaining[0].id);
          loadMessages(remaining[0].id);
        } else {
          setActiveId(null);
          setMsgs([]);
        }
      }
    },
    [convos, activeId, loadMessages, stopStream],
  );

  const activeTitle = useMemo(
    () => convos.find((c) => c.id === activeId)?.title ?? "新对话",
    [convos, activeId],
  );

  return {
    convos,
    setConvos,
    activeId,
    setActiveId,
    activeIdRef,
    msgs,
    setMsgs,
    convosLoading,
    msgsLoading,
    loadMessages,
    pickConvo,
    newChat,
    renamingId,
    setRenamingId,
    renameVal,
    setRenameVal,
    startRename,
    commitRename,
    removeConvo,
    activeTitle,
  };
}

export type ConversationsApi = ReturnType<typeof useConversations>;
