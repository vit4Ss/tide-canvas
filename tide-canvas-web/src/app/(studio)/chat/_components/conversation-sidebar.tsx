"use client";

/* ── conversation list sidebar (extracted verbatim from page.tsx) ──────────────
   新对话按钮 + 最近对话列表（行内重命名 Enter/blur 提交、Esc 取消，删除带确认）。 */

import type { ConversationVO } from "@/types/chat";

export function ConversationSidebar({
  convos,
  convosLoading,
  activeId,
  busy,
  renamingId,
  renameVal,
  onNewChat,
  onPick,
  onStartRename,
  onRenameChange,
  onCommitRename,
  onCancelRename,
  onRemove,
}: {
  convos: ConversationVO[];
  convosLoading: boolean;
  activeId: string | null;
  busy: boolean;
  renamingId: string | null;
  renameVal: string;
  onNewChat: () => void;
  onPick: (id: string) => void;
  onStartRename: (c: ConversationVO) => void;
  onRenameChange: (v: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onRemove: (c: ConversationVO) => void;
}) {
  return (
    <aside className="chat-list">
      <div className="chat-list-top">
        <button className="chat-new" onClick={onNewChat} disabled={busy}>
          <span>＋</span> 新对话
        </button>
      </div>
      <div className="chat-convos">
        <div className="chat-ch">最近对话</div>
        {convosLoading ? (
          <div className="convo">
            <span className="t" style={{ color: "var(--text-faint)" }}>
              加载中…
            </span>
          </div>
        ) : convos.length === 0 ? (
          <div className="convo">
            <span className="t" style={{ color: "var(--text-faint)" }}>
              还没有对话，点击「新对话」开始
            </span>
          </div>
        ) : (
          convos.map((c) =>
            renamingId === c.id ? (
              <div key={c.id} className="convo on">
                <input
                  className="convo-rename"
                  autoFocus
                  value={renameVal}
                  onChange={(e) => onRenameChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onCommitRename();
                    } else if (e.key === "Escape") {
                      onCancelRename();
                    }
                  }}
                  onBlur={onCommitRename}
                />
              </div>
            ) : (
              <div key={c.id} className={`convo ${c.id === activeId ? "on" : ""}`}>
                <button className="convo-main" type="button" onClick={() => onPick(c.id)}>
                  <svg viewBox="0 0 24 24">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  <span className="t">{c.title || "未命名对话"}</span>
                </button>
                <button
                  className="convo-act"
                  type="button"
                  title="重命名"
                  onClick={(e) => {
                    e.stopPropagation();
                    onStartRename(c);
                  }}
                >
                  ✎
                </button>
                <button
                  className="convo-act"
                  type="button"
                  title="删除"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(c);
                  }}
                >
                  🗑
                </button>
              </div>
            ),
          )
        )}
      </div>
    </aside>
  );
}
