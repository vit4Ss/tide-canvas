"use client";

/* ============================================================================
   CanvasHelpModal — 画布「帮助 / 客服」弹窗。两个 tab：帮助(常见问题手风琴) 与
   客服(联系方式)。纯前端静态内容，通过 portal 渲染到 body，支持 Esc / 点遮罩关闭。
   ========================================================================== */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, ChevronDown, Mail, HelpCircle, LifeBuoy } from "lucide-react";
import { useFocusTrap } from "@/hooks/use-focus-trap";

export type HelpTab = "help" | "support";

const FAQS: { q: string; a: string }[] = [
  {
    q: "如何在画布上创建内容？",
    a: "点击左侧工具栏的「+」选择节点类型，或直接把本地图片/视频拖入画布；也可右键画布空白处选择「上传」。在图片/文本节点里输入提示词即可生成。",
  },
  {
    q: "节点之间如何连线？",
    a: "把鼠标移到节点边缘的连接点上，按住拖动到目标节点即可建立引用关系。图生图 / 首尾帧等会按连线顺序把上游图片作为参考输入。",
  },
  {
    q: "九宫格切分怎么用？",
    a: "选中已生成的图片，在顶部工具栏点「九宫格」或「宫格切分」，进入预览后可点选要保留的格子，再点「创建分镜组」即可把每格拆成独立节点。",
  },
  {
    q: "打光 / 高清 / 镜像有什么区别？",
    a: "「打光」与「高清」会调用 AI 对图片重新打光或放大增强(消耗积分)；「镜像」是纯本地的水平翻转，不消耗积分，立即生效。",
  },
  {
    q: "作品会自动保存吗？",
    a: "会。画布内容会自动保存到当前项目，生成的图片/视频也会存入你的资产库，可在「我的素材」中随时取用。",
  },
];

function Accordion() {
  const [open, setOpen] = useState(0);
  return (
    <div className="flex flex-col gap-2">
      {FAQS.map((f, i) => (
        <div
          key={i}
          className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-700"
        >
          <button
            onClick={() => setOpen(open === i ? -1 : i)}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium text-neutral-800 transition-colors hover:bg-neutral-50 dark:text-neutral-100 dark:hover:bg-neutral-800"
          >
            {f.q}
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform ${open === i ? "rotate-180" : ""}`}
            />
          </button>
          {open === i && (
            <div className="px-4 pb-3 text-[13px] leading-relaxed text-neutral-600 dark:text-neutral-300">
              {f.a}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Support() {
  return (
    <div className="flex flex-col gap-3 text-sm text-neutral-700 dark:text-neutral-200">
      <p className="text-[13px] leading-relaxed text-neutral-600 dark:text-neutral-300">
        遇到问题或有建议？我们很乐意帮忙。可通过以下方式联系我们，工作日通常在
        24 小时内回复。
      </p>
      <a
        href="mailto:ad@tcmzhan.com"
        className="flex items-center gap-3 rounded-xl border border-neutral-200 px-4 py-3 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
          <Mail className="h-4 w-4" />
        </span>
        <span className="flex flex-col">
          <span className="font-medium">邮件支持</span>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">ad@tcmzhan.com</span>
        </span>
      </a>
      <div className="flex items-center gap-3 rounded-xl border border-neutral-200 px-4 py-3 dark:border-neutral-700">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
          <LifeBuoy className="h-4 w-4" />
        </span>
        <span className="flex flex-col">
          <span className="font-medium">帮助中心</span>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            常见问题请查看「帮助」标签页
          </span>
        </span>
      </div>
    </div>
  );
}

export function CanvasHelpModal({
  open,
  onClose,
  initialTab = "help",
}: {
  open: boolean;
  onClose: () => void;
  initialTab?: HelpTab;
}) {
  const [tab, setTab] = useState<HelpTab>(initialTab);
  const dialogRef = useFocusTrap<HTMLDivElement>(open);

  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl outline-none dark:border-neutral-700 dark:bg-neutral-900"
        role="dialog"
        aria-modal="true"
        aria-label="帮助与支持"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3.5 dark:border-neutral-800">
          <div className="flex items-center gap-2 text-[15px] font-semibold text-neutral-800 dark:text-neutral-100">
            <HelpCircle className="h-4 w-4 text-neutral-500" />
            帮助与支持
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div role="tablist" className="flex gap-1 border-b border-neutral-200 px-3 pt-2 dark:border-neutral-800">
          {[
            { key: "help" as const, label: "帮助" },
            { key: "support" as const, label: "客服" },
          ].map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-t-lg px-4 py-2 text-sm font-medium transition-colors ${
                tab === t.key
                  ? "border-b-2 border-neutral-800 text-neutral-900 dark:border-neutral-100 dark:text-white"
                  : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-5">
          {tab === "help" ? <Accordion /> : <Support />}
        </div>
      </div>
    </div>,
    document.body,
  );
}
