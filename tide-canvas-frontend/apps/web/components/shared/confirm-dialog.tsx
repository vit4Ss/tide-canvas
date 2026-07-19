"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open, title, message, confirmText = "确认", cancelText = "取消",
  danger = false, loading = false, onConfirm, onCancel,
}: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !loading) onCancel();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="max-w-[calc(100%-2rem)] gap-0 overflow-hidden rounded-[18px] border border-neutral-200/80 bg-white p-0 shadow-[0_18px_56px_rgba(15,23,42,0.18)] sm:max-w-[384px] dark:border-neutral-800 dark:bg-neutral-950"
      >
        <DialogHeader className="flex-row items-start gap-3 px-5 pb-3 pt-5">
          {danger && (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600 ring-1 ring-red-100 dark:bg-red-950/40 dark:text-red-400 dark:ring-red-900/50">
              <AlertTriangle className="h-[18px] w-[18px]" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[15px] font-semibold leading-6 text-neutral-950 dark:text-neutral-50">
              {title}
            </DialogTitle>
            {message && (
              <DialogDescription className="mt-1.5 text-[13px] leading-5 text-neutral-500 dark:text-neutral-400">
                {message}
              </DialogDescription>
            )}
          </div>
        </DialogHeader>

        <div className="flex justify-end gap-2 px-5 pb-5 pt-1">
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={onCancel}
            className="h-8 min-w-[64px] rounded-lg border-neutral-200 bg-white px-3 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-200 dark:hover:bg-neutral-900"
          >
            {cancelText}
          </Button>
          <Button
            type="button"
            disabled={loading}
            onClick={onConfirm}
            className={cn(
              "h-8 min-w-[82px] rounded-lg px-3 text-white shadow-none",
              danger ? "bg-red-600 hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-500" : "bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200",
            )}
          >
            {loading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {confirmText}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
