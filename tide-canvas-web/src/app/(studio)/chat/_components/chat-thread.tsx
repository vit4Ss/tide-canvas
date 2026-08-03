"use client";

/* ── message thread (extracted verbatim from page.tsx) ─────────────────────────
   加载占位 / 空态欢迎 / 消息气泡列表 / 流式气泡(思考中 + caret) / typing 圆点
   / 「跳到最新」按钮。 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { MessageVO } from "@/types/chat";
import type { SkillRunAction } from "@/types/skill-run";
import type { SkillRunPanelActionPayload } from "@/components/skill/skill-run-panel";
import { Bubble, MD_COMPONENTS } from "./message-bubble";
import type { LightboxItem } from "./chat-utils";

export function ChatThread({
  threadRef,
  onThreadScroll,
  msgsLoading,
  msgs,
  avatar,
  onReEdit,
  onRegenerate,
  onOpenLightbox,
  onSkillRunAction,
  swatchFor,
  fallbackModelByMsg,
  curModelName,
  streaming,
  typing,
  showJump,
  onJumpToLatest,
}: {
  threadRef: React.RefObject<HTMLDivElement | null>;
  onThreadScroll: () => void;
  msgsLoading: boolean;
  msgs: MessageVO[];
  /** 当前所选模型的头像（加载占位/空态/流式/typing 气泡共用）。 */
  avatar: React.ReactNode;
  onReEdit: (m: MessageVO) => void;
  onRegenerate: (m: MessageVO) => void;
  onOpenLightbox: (items: LightboxItem[], index: number) => void;
  onSkillRunAction: (
    runId: string,
    action: SkillRunAction,
    payload?: SkillRunPanelActionPayload,
    expectedRevision?: number,
  ) => void | Promise<unknown>;
  swatchFor: (name: string) => { style: React.CSSProperties; glyph: string };
  /** 任务没存 modelName 时的兜底模型名表（该轮 params.model）。 */
  fallbackModelByMsg: Map<string, string>;
  /** 再退一档的兜底：当前所选模型名。 */
  curModelName: string;
  streaming: string | null;
  typing: boolean;
  showJump: boolean;
  onJumpToLatest: () => void;
}) {
  return (
    <div className="chat-thread" ref={threadRef} onScroll={onThreadScroll}>
      <div className="chat-inner">
        {msgsLoading && msgs.length === 0 ? (
          <div className="msg ai">
            {avatar}
            <div className="bubble">
              <span className="typing">
                <i />
                <i />
                <i />
              </span>
            </div>
          </div>
        ) : !msgsLoading && msgs.length === 0 ? (
          <div className="msg ai">
            {avatar}
            <div className="bubble">
              <div>
                你好！我是你的 流光 创作助手。告诉我你想创作的内容 ——
                图片、视频、剧本或灵感，我来帮你一步步完成。
              </div>
            </div>
          </div>
        ) : (
          msgs.map((m) => (
            <Bubble
              key={m.id}
              msg={m}
              onReEdit={onReEdit}
              onRegenerate={onRegenerate}
              onOpenLightbox={onOpenLightbox}
              onSkillRunAction={onSkillRunAction}
              swatchFor={swatchFor}
              fallbackModel={fallbackModelByMsg.get(m.id) || curModelName}
            />
          ))
        )}
        {streaming !== null && (
          <div className="msg ai">
            {avatar}
            <div className="bubble">
              {streaming === "" ? (
                <span className="chat-gen-state">
                  <span className="typing">
                    <i />
                    <i />
                    <i />
                  </span>
                  思考中…
                </span>
              ) : (
                <div className="md">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>{streaming}</ReactMarkdown>
                  <span className="stream-caret" />
                </div>
              )}
            </div>
          </div>
        )}
        {typing && (
          <div className="msg ai">
            {avatar}
            <div className="bubble">
              <span className="typing">
                <i />
                <i />
                <i />
              </span>
            </div>
          </div>
        )}
      </div>
      {showJump && (
        <button className="chat-jump" type="button" onClick={onJumpToLatest}>
          ↓ 跳到最新
        </button>
      )}
    </div>
  );
}
