"use client";

import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "@/components/shared/toast";
import { projectApi } from "@/lib/api";

interface UseCanvasProjectTitleOptions {
  projectId: string | null;
  projectName: string;
  setProjectName: Dispatch<SetStateAction<string>>;
}

export interface CanvasProjectTitleState {
  editing: boolean;
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  startEditing: () => void;
  cancelEditing: () => void;
  confirmEditing: () => Promise<void>;
}

export function useCanvasProjectTitle({
  projectId,
  projectName,
  setProjectName,
}: UseCanvasProjectTitleOptions): CanvasProjectTitleState {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const confirmingRef = useRef(false);

  const startEditing = (): void => {
    setDraft(projectName);
    setEditing(true);
  };

  const cancelEditing = (): void => {
    setDraft(projectName);
    setEditing(false);
  };

  const confirmEditing = async (): Promise<void> => {
    // Enter 关闭输入框后会继续触发 blur；用 ref 保证只发一个更新请求。
    if (confirmingRef.current) return;
    confirmingRef.current = true;
    try {
      const nextName = draft.trim();
      if (!nextName || nextName === projectName) {
        setEditing(false);
        return;
      }

      const previousName = projectName;
      setProjectName(nextName);
      setEditing(false);
      if (!projectId) return;

      const response = await projectApi.update(projectId, { name: nextName });
      if (response.success) {
        toast.success("项目名已更新");
      } else {
        setProjectName(previousName);
        toast.error(response.message || "重命名失败");
      }
    } finally {
      confirmingRef.current = false;
    }
  };

  return {
    editing,
    draft,
    setDraft,
    startEditing,
    cancelEditing,
    confirmEditing,
  };
}
