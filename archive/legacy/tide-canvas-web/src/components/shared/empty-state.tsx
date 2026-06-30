"use client";

import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import type { ReactNode } from "react";

interface Props {
  icon?: LucideIcon;
  title?: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon = Inbox, title = "暂无数据", description, action, className }: Props) {
  return (
    <div className={`flex flex-col items-center justify-center py-16 text-center ${className || ""}`}>
      <Icon className="h-10 w-10 text-neutral-300 dark:text-neutral-600" />
      <p className="mt-3 text-sm text-neutral-500">{title}</p>
      {description && <p className="mt-1 text-xs text-neutral-400">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
