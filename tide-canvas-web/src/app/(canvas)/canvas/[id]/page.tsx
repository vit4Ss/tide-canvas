"use client";

import { useCallback } from "react";
import { notFound, useParams, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { CanvasView } from "@/components/canvas/canvas-view";
import { useCanvasProjectSession } from "@/features/canvas/application/project/use-canvas-project-session";
import {
  CanvasEditorHeader,
  CanvasSaveConflictAlert,
} from "@/features/canvas/presentation/editor/canvas-editor-chrome";
import { CanvasErrorBoundary } from "@/features/canvas/presentation/errors/canvas-error-boundary";

export default function CanvasEditorPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  // URL 中的 [id] 是不透明 token，真实项目 ID 不暴露在地址栏。
  const token = params.id as string;
  const handoffId = searchParams.get("handoff") || "";
  const replaceRoute = useCallback(
    (href: string) => router.replace(href),
    [router],
  );
  const session = useCanvasProjectSession({ token, handoffId, replaceRoute });

  if (session.missing) notFound();

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      {session.loaded ? (
        <CanvasErrorBoundary scope="editor" resetKey={token}>
          <CanvasView
            launchJournal={session.launchJournal}
            persistenceReady={session.persistenceReady}
            onLaunchConsumed={session.consumeLaunchJournal}
          />
        </CanvasErrorBoundary>
      ) : (
        <div className="absolute inset-0 grid place-items-center bg-neutral-50 text-neutral-400 dark:bg-neutral-950">
          <Loader2 className="h-5 w-5 animate-spin" aria-label="正在加载画布" />
        </div>
      )}

      <CanvasEditorHeader
        projectName={session.projectName}
        saving={session.saving}
        lastSaved={session.lastSaved}
        title={session.title}
      />
      {session.saveConflict && <CanvasSaveConflictAlert />}
    </div>
  );
}
