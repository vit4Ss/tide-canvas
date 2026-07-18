"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Image as ImageIcon, Loader2, MessageSquare, MoreHorizontal, Pin, PinOff, Trash2, Video } from "lucide-react";
import { conversationApi } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "@/components/shared/toast";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  CONVERSATIONS_CHANGED_EVENT,
  notifyConversationsChanged,
  type CreationConversationVO,
  type CreationMode,
} from "@/types/conversation";
import styles from "./sidebar.module.css";

const MODE_ICON: Record<CreationMode, typeof MessageSquare> = {
  text: MessageSquare,
  image: ImageIcon,
  video: Video,
};

type TimeGroup = "今天" | "过去 7 天" | "更早";

function groupFor(value?: string): TimeGroup {
  const time = value ? new Date(value).getTime() : 0;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (time >= startOfToday) return "今天";
  if (time >= startOfToday - 6 * 24 * 60 * 60 * 1000) return "过去 7 天";
  return "更早";
}

export function ConversationHistory() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { initialized, isLoggedIn } = useAuth();
  const activeID = searchParams.get("conversation") ?? "";
  const [items, setItems] = useState<CreationConversationVO[]>([]);
  const [loading, setLoading] = useState(false);
  const [menuID, setMenuID] = useState("");
  const [menuUp, setMenuUp] = useState(false);
  const [renamingID, setRenamingID] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<CreationConversationVO | null>(null);
  const [deleting, setDeleting] = useState(false);
  const menuRootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!isLoggedIn) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      const collected: CreationConversationVO[] = [];
      let pageNum = 1;
      let total = 0;
      do {
        const res = await conversationApi.list({ pageNum, pageSize: 100 });
        if (!res.success) break;
        const records = res.data.records ?? [];
        collected.push(...records);
        total = res.data.total ?? collected.length;
        if (records.length === 0) break;
        pageNum += 1;
      } while (collected.length < total);
      setItems(collected);
    } finally {
      setLoading(false);
    }
  }, [isLoggedIn]);

  useEffect(() => {
    if (!initialized) return;
    void load();
  }, [initialized, load]);

  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener(CONVERSATIONS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(CONVERSATIONS_CHANGED_EVENT, refresh);
  }, [load]);

  useEffect(() => {
    if (!menuID) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && menuRootRef.current?.contains(event.target)) return;
      setMenuID("");
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [menuID]);

  const grouped = useMemo(() => {
    const result: Record<TimeGroup, CreationConversationVO[]> = { 今天: [], "过去 7 天": [], 更早: [] };
    items.filter((item) => !item.pinned).forEach((item) => {
      result[groupFor(item.lastMessageTime || item.updateTime)].push(item);
    });
    return result;
  }, [items]);
  const pinned = items.filter((item) => item.pinned);

  const openConversation = (item: CreationConversationVO) => {
    setMenuID("");
    router.push(`/?conversation=${encodeURIComponent(item.id)}`);
  };

  const togglePinned = async (item: CreationConversationVO) => {
    const res = await conversationApi.update(item.id, { pinned: !item.pinned });
    if (!res.success) {
      toast.error(res.message || "操作失败");
      return;
    }
    setMenuID("");
    notifyConversationsChanged();
  };

  const beginRename = (item: CreationConversationVO) => {
    setRenamingID(item.id);
    setRenameValue(item.title);
    setMenuID("");
  };

  const saveRename = async (item: CreationConversationVO) => {
    const title = renameValue.trim();
    if (!title) return;
    const res = await conversationApi.update(item.id, { title });
    if (!res.success) {
      toast.error(res.message || "重命名失败");
      return;
    }
    setRenamingID("");
    notifyConversationsChanged();
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const targetID = deleteTarget.id;
    try {
      const res = await conversationApi.delete(targetID);
      if (!res.success) {
        toast.error(res.message || "删除失败");
        return;
      }
      setDeleteTarget(null);
      notifyConversationsChanged();
      if (activeID === targetID) router.push("/");
    } finally {
      setDeleting(false);
    }
  };

  const renderItem = (item: CreationConversationVO) => {
    const Icon = MODE_ICON[item.mode] ?? MessageSquare;
    const active = item.id === activeID;
    return (
      <div key={item.id} className={styles.historyItem} data-active={active || undefined}>
        {renamingID === item.id ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onBlur={() => void saveRename(item)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void saveRename(item);
              if (event.key === "Escape") setRenamingID("");
            }}
            className={styles.historyRenameInput}
            maxLength={60}
          />
        ) : (
          <button type="button" className={styles.historyOpenButton} onClick={() => openConversation(item)} title={item.title}>
            <Icon size={14} strokeWidth={1.8} className={styles.historyModeIcon} />
            <span>{item.title}</span>
          </button>
        )}
        {renamingID !== item.id && (
          <div className={styles.historyMenuRoot} ref={menuID === item.id ? menuRootRef : undefined}>
            <button
              type="button"
              className={styles.historyMoreButton}
              onClick={(event) => {
                setMenuUp(event.currentTarget.getBoundingClientRect().bottom + 112 > window.innerHeight);
                setMenuID((current) => current === item.id ? "" : item.id);
              }}
              aria-label="会话操作"
            >
              <MoreHorizontal size={15} />
            </button>
            {menuID === item.id && (
              <div className={styles.historyMenu} data-up={menuUp || undefined}>
                <button type="button" onClick={() => beginRename(item)}>重命名</button>
                <button type="button" onClick={() => void togglePinned(item)}>
                  {item.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                  {item.pinned ? "取消置顶" : "置顶"}
                </button>
                <button type="button" data-danger onClick={() => { setDeleteTarget(item); setMenuID(""); }}>
                  <Trash2 size={13} />
                  删除
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  if (!initialized || !isLoggedIn) return null;

  return (
    <section className={styles.historySection} aria-label="最近会话">
      <div className={styles.historyHeader}>
        <span>最近会话</span>
        {loading && <Loader2 size={13} className={styles.historySpinner} />}
      </div>
      <div className={styles.historyList}>
        {!loading && items.length === 0 && <p className={styles.historyEmpty}>发送第一条消息后，会话会显示在这里</p>}
        {pinned.length > 0 && (
          <div className={styles.historyGroup}>
            <div className={styles.historyGroupLabel}>置顶</div>
            {pinned.map(renderItem)}
          </div>
        )}
        {(["今天", "过去 7 天", "更早"] as TimeGroup[]).map((group) => grouped[group].length > 0 && (
          <div key={group} className={styles.historyGroup}>
            <div className={styles.historyGroupLabel}>{group}</div>
            {grouped[group].map(renderItem)}
          </div>
        ))}
      </div>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除这个会话？"
        message="会话、未加入素材库的附件和生成结果将一并删除，此操作不可恢复。"
        confirmText="删除会话"
        danger
        loading={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  );
}
