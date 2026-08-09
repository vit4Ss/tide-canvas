"use client";

import { useCallback, useRef, useState } from "react";
import { clearCanvasLaunchJournal, type CanvasLaunchJournal } from "@/lib/canvas-launch";
import { useCanvasPersistence } from "../persistence/use-canvas-persistence";
import { useCanvasProjectLoader } from "./use-canvas-project-loader";
import { useCanvasProjectTitle, type CanvasProjectTitleState } from "./use-canvas-project-title";

interface UseCanvasProjectSessionOptions {
  token: string;
  handoffId: string;
  replaceRoute: (href: string) => void;
}

export interface CanvasProjectSessionState {
  projectId: string | null;
  projectName: string;
  missing: boolean;
  loaded: boolean;
  saving: boolean;
  lastSaved: string | null;
  saveConflict: boolean;
  persistenceReady: boolean;
  launchJournal: CanvasLaunchJournal | null;
  title: CanvasProjectTitleState;
  consumeLaunchJournal: () => void;
}

/** `/canvas/[id]` 的页面级应用控制器。 */
export function useCanvasProjectSession({
  token,
  handoffId,
  replaceRoute,
}: UseCanvasProjectSessionOptions): CanvasProjectSessionState {
  const revisionRef = useRef<number | null>(null);
  const documentExtensionsRef = useRef<Record<string, unknown>>({});
  const saveConflictRef = useRef(false);
  const [saveConflict, setSaveConflict] = useState(false);

  const loader = useCanvasProjectLoader({
    token,
    handoffId,
    replaceRoute,
    revisionRef,
    documentExtensionsRef,
    saveConflictRef,
    setSaveConflict,
  });
  const persistence = useCanvasPersistence({
    projectId: loader.projectId,
    thumbnail: loader.thumbnail,
    loaded: loader.loaded,
    revisionRef,
    documentExtensionsRef,
    saveConflictRef,
    saveConflict,
    setSaveConflict,
  });
  const title = useCanvasProjectTitle({
    projectId: loader.projectId,
    projectName: loader.projectName,
    setProjectName: loader.setProjectName,
  });

  const launchJournalId = loader.launchJournal?.id;
  const setLaunchJournal = loader.setLaunchJournal;
  const consumeLaunchJournal = useCallback(() => {
    if (launchJournalId) clearCanvasLaunchJournal(launchJournalId);
    setLaunchJournal(null);
    replaceRoute(`/canvas/${encodeURIComponent(token)}`);
  }, [launchJournalId, replaceRoute, setLaunchJournal, token]);

  return {
    projectId: loader.projectId,
    projectName: loader.projectName,
    missing: loader.missing,
    loaded: loader.loaded,
    launchJournal: loader.launchJournal,
    saving: persistence.saving,
    lastSaved: persistence.lastSaved,
    persistenceReady: persistence.persistenceReady,
    saveConflict,
    title,
    consumeLaunchJournal,
  };
}
