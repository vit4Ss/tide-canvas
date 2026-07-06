"use client";

import type { RefObject } from "react";
import { ArrowUp, ChevronDown, FileText, Loader2, Maximize2, Minimize2, Plus, X, Zap } from "lucide-react";
import { formatFileSize } from "./format";
import type { AiModelVO } from "@/types/ai";
import type { FileVO } from "@/types/file";

interface AssistantComposerProps {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  modelMenuRef: RefObject<HTMLDivElement | null>;
  message: string;
  inputExpanded: boolean;
  attachments: FileVO[];
  uploading: boolean;
  uploadProgress: number;
  models: AiModelVO[];
  selectedModel?: AiModelVO;
  modelsLoading: boolean;
  modelOpen: boolean;
  pointLabel: string;
  sending: boolean;
  canSubmit: boolean;
  onMessageChange: (value: string) => void;
  onInputKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveAttachment: (fileUrl: string) => void;
  onToggleInputExpanded: () => void;
  onToggleModelOpen: () => void;
  onSelectModel: (model: AiModelVO) => void;
  onSubmit: () => void;
}

export function AssistantComposer({
  inputRef,
  fileInputRef,
  modelMenuRef,
  message,
  inputExpanded,
  attachments,
  uploading,
  uploadProgress,
  models,
  selectedModel,
  modelsLoading,
  modelOpen,
  pointLabel,
  sending,
  canSubmit,
  onMessageChange,
  onInputKeyDown,
  onFileChange,
  onRemoveAttachment,
  onToggleInputExpanded,
  onToggleModelOpen,
  onSelectModel,
  onSubmit,
}: AssistantComposerProps) {
  return (
    <div className="shrink-0 rounded-2xl bg-white p-3 shadow-sm outline-none ring-1 ring-neutral-200/70 dark:bg-[#28292e] dark:ring-white/8">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={onFileChange}
      />
      {attachments.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {attachments.map((file) => (
            <div
              key={file.fileUrl}
              className="flex max-w-full items-center gap-2 rounded-xl bg-neutral-50 px-2.5 py-2 text-xs text-neutral-700 ring-1 ring-neutral-200/70 dark:bg-white/6 dark:text-neutral-200 dark:ring-white/10"
              title={file.originalName}
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-neutral-500 dark:text-neutral-400" />
              <div className="min-w-0">
                <div className="max-w-[210px] truncate font-medium">{file.originalName}</div>
                <div className="text-[11px] text-neutral-500 dark:text-neutral-400">{formatFileSize(file.fileSize)}</div>
              </div>
              <button
                type="button"
                onClick={() => onRemoveAttachment(file.fileUrl)}
                className="rounded-md p-1 text-neutral-400 transition-colors hover:bg-neutral-200/70 hover:text-neutral-700 dark:hover:bg-white/10 dark:hover:text-white"
                title="移除文件"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      {uploading && (
        <div className="mb-3 flex items-center gap-2 rounded-xl bg-neutral-50 px-3 py-2 text-xs text-neutral-600 ring-1 ring-neutral-200/70 dark:bg-white/6 dark:text-neutral-300 dark:ring-white/10">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>上传中{uploadProgress > 0 ? ` ${uploadProgress}%` : ""}</span>
        </div>
      )}
      <div className="relative">
        <textarea
          ref={inputRef}
          value={message}
          onChange={(event) => onMessageChange(event.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder="开启你的灵感之旅"
          rows={2}
          className={(inputExpanded ? "min-h-[180px]" : "min-h-[64px]") + " block w-full resize-none overflow-hidden rounded-none border-0 bg-transparent p-0 pr-8 text-sm leading-5 text-neutral-900 outline-none ring-0 placeholder:text-neutral-400 focus:border-transparent focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 dark:text-neutral-100 dark:placeholder:text-neutral-500"}
          style={{
            appearance: "none",
            WebkitAppearance: "none",
            border: "none",
            outline: "none",
            boxShadow: "none",
          }}
        />
        <button
          type="button"
          onClick={onToggleInputExpanded}
          className="absolute right-0 top-0 rounded-lg p-1.5 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white"
          title={inputExpanded ? "收起输入区" : "放大输入区"}
        >
          {inputExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </button>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3 text-sm text-neutral-700 dark:text-neutral-300">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="rounded-lg p-1.5 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/10"
            title="上传文件"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          </button>
          <div className="relative min-w-0" ref={modelMenuRef}>
            <button
              type="button"
              onClick={onToggleModelOpen}
              className="inline-flex max-w-[190px] items-center gap-2 rounded-lg px-2 py-1 font-medium transition-colors hover:bg-neutral-100 dark:hover:bg-white/10"
              title="选择模型"
              aria-expanded={modelOpen}
            >
              <span className="truncate">{selectedModel?.name ?? (modelsLoading ? "加载模型..." : "选择模型")}</span>
              <ChevronDown className={(modelOpen ? "rotate-180" : "rotate-0") + " h-3.5 w-3.5 text-neutral-500 transition-transform duration-200"} />
            </button>
            {modelOpen && (
              <div className="absolute bottom-11 left-0 z-40 max-h-56 w-56 overflow-y-auto rounded-2xl bg-white p-1 text-sm text-neutral-800 shadow-xl ring-1 ring-neutral-200/80 dark:bg-[#25262b] dark:text-neutral-100 dark:ring-white/10">
                {models.length ? models.map((model) => (
                  <button
                    key={model.modelId}
                    type="button"
                    onClick={() => onSelectModel(model)}
                    className={(model.modelId === selectedModel?.modelId ? "bg-neutral-100 text-neutral-950 dark:bg-white/10 dark:text-white" : "text-neutral-700 dark:text-neutral-200") + " block w-full rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-neutral-100 dark:hover:bg-white/8"}
                  >
                    <span className="block truncate font-medium leading-5">{model.name}</span>
                  </button>
                )) : (
                  <div className="px-3 py-2 text-neutral-500 dark:text-neutral-400">暂无可用模型</div>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-neutral-50 px-2 pl-3 shadow-sm ring-1 ring-neutral-100 dark:bg-[#303137] dark:ring-white/8">
          <span className="flex items-center gap-1 text-xs font-medium text-neutral-700 dark:text-neutral-200">
            <Zap className="h-3 w-3 text-neutral-900 dark:text-neutral-100" fill="currentColor" />
            {pointLabel}
          </span>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={onSubmit}
            className={(canSubmit
              ? "bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
              : "bg-neutral-100 text-neutral-400 dark:bg-neutral-700 dark:text-neutral-500") + " flex h-8 w-8 items-center justify-center rounded-full transition-colors"}
            title="发送"
          >
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
