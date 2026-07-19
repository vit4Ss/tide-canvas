"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownRight, Bot } from "lucide-react";
import { resolveAssistantPetStyle } from "@/lib/assistant-pet-styles";
import type { AssistantPetStyle } from "@/types/assistant";
import { AssistantPetSprite } from "./assistant-pet-sprite";
import {
  ASSISTANT_PET_STYLE_EVENT,
  ASSISTANT_PET_STYLE_STORAGE_KEY,
  fetchAssistantPetStyles,
  loadSelectedAssistantPetStyleId,
} from "./pet-style";

interface AssistantLauncherPosition {
  x: number;
  y: number;
}

interface AssistantLauncherDragState {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  width: number;
  height: number;
  moved: boolean;
}

interface AssistantLauncherResizeState {
  pointerId: number;
  startX: number;
  startY: number;
  originSize: number;
  originX: number;
  originY: number;
  moved: boolean;
}

interface AssistantLauncherProps {
  onOpen: () => void;
}

const POSITION_STORAGE_KEY = "tc:assistant:launcherPosition";
const SIZE_STORAGE_KEY = "tc:assistant:launcherSize";
const LAUNCHER_MARGIN = 12;
const DRAG_THRESHOLD = 6;
const DEFAULT_LAUNCHER_SIZE = 118;
const MIN_LAUNCHER_SIZE = 72;
const MAX_LAUNCHER_SIZE = 190;
const RESIZE_HANDLE_SPACE = 26;

function clampLauncherPosition(position: AssistantLauncherPosition, width: number, height: number): AssistantLauncherPosition {
  if (typeof window === "undefined") return position;
  const maxX = Math.max(LAUNCHER_MARGIN, window.innerWidth - width - LAUNCHER_MARGIN);
  const maxY = Math.max(LAUNCHER_MARGIN, window.innerHeight - height - LAUNCHER_MARGIN);
  return {
    x: Math.min(maxX, Math.max(LAUNCHER_MARGIN, position.x)),
    y: Math.min(maxY, Math.max(LAUNCHER_MARGIN, position.y)),
  };
}

function launcherBoxSize(petSize: number) {
  return petSize + RESIZE_HANDLE_SPACE;
}

function clampLauncherSize(size: number) {
  return Math.min(MAX_LAUNCHER_SIZE, Math.max(MIN_LAUNCHER_SIZE, Math.round(size)));
}

function loadLauncherPosition() {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(POSITION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AssistantLauncherPosition>;
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null;
    return { x: Number(parsed.x), y: Number(parsed.y) } satisfies AssistantLauncherPosition;
  } catch {
    return null;
  }
}

function saveLauncherPosition(position: AssistantLauncherPosition) {
  if (typeof window === "undefined") return;
  localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(position));
}

function loadLauncherSize() {
  if (typeof window === "undefined") return DEFAULT_LAUNCHER_SIZE;
  const stored = Number(localStorage.getItem(SIZE_STORAGE_KEY));
  return Number.isFinite(stored) ? clampLauncherSize(stored) : DEFAULT_LAUNCHER_SIZE;
}

function saveLauncherSize(size: number) {
  if (typeof window === "undefined") return;
  localStorage.setItem(SIZE_STORAGE_KEY, String(clampLauncherSize(size)));
}

export function AssistantLauncher({ onOpen }: AssistantLauncherProps) {
  const [position, setPosition] = useState<AssistantLauncherPosition | null>(null);
  const [petSize, setPetSize] = useState(DEFAULT_LAUNCHER_SIZE);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [petStyles, setPetStyles] = useState<AssistantPetStyle[]>([]);
  const [selectedPetStyleId, setSelectedPetStyleId] = useState<string | null>(null);
  const launcherRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<AssistantLauncherDragState | null>(null);
  const resizeRef = useRef<AssistantLauncherResizeState | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    setPosition(loadLauncherPosition());
    setPetSize(loadLauncherSize());
    setSelectedPetStyleId(loadSelectedAssistantPetStyleId());
  }, []);

  const refreshPetStyles = useCallback(async () => {
    try {
      const styles = await fetchAssistantPetStyles();
      setPetStyles(styles);
      setSelectedPetStyleId(loadSelectedAssistantPetStyleId());
    } catch {
      setPetStyles([]);
    }
  }, []);

  useEffect(() => {
    refreshPetStyles();
  }, [refreshPetStyles]);

  useEffect(() => {
    const handlePetStyleChange = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : undefined;
      const styleId = detail && typeof detail === "object" && "styleId" in detail ? String(detail.styleId || "") : "";
      setSelectedPetStyleId(styleId || loadSelectedAssistantPetStyleId());
    };
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === ASSISTANT_PET_STYLE_STORAGE_KEY) setSelectedPetStyleId(loadSelectedAssistantPetStyleId());
    };
    window.addEventListener(ASSISTANT_PET_STYLE_EVENT, handlePetStyleChange);
    window.addEventListener("storage", handleStorageChange);
    return () => {
      window.removeEventListener(ASSISTANT_PET_STYLE_EVENT, handlePetStyleChange);
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []);

  useEffect(() => {
    if (!position) return;

    const clampCurrentPosition = () => {
      const launcher = launcherRef.current;
      if (!launcher) return;
      const next = clampLauncherPosition(position, launcherBoxSize(petSize), launcherBoxSize(petSize));
      if (Math.abs(next.x - position.x) > 0.5 || Math.abs(next.y - position.y) > 0.5) {
        setPosition(next);
        saveLauncherPosition(next);
      }
    };

    clampCurrentPosition();
    window.addEventListener("resize", clampCurrentPosition);
    return () => window.removeEventListener("resize", clampCurrentPosition);
  }, [petSize, position]);

  const beginDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const rect = launcherRef.current?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.left,
      originY: rect.top,
      width: rect.width,
      height: rect.height,
      moved: false,
    };
    setDragging(true);
    // Pointer capture keeps the drag stable even if the cursor leaves the launcher.
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const dragState = dragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;
    const hasMoved = Math.hypot(deltaX, deltaY) >= DRAG_THRESHOLD;
    if (!dragState.moved && !hasMoved) return;

    dragState.moved = true;
    suppressClickRef.current = true;
    event.preventDefault();
    const boxSize = launcherBoxSize(petSize);
    const next = clampLauncherPosition({
      x: dragState.originX + deltaX,
      y: dragState.originY + deltaY,
    }, boxSize, boxSize);
    setPosition(next);
  };

  const endDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const dragState = dragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);

    if (dragState.moved) {
      event.preventDefault();
      const boxSize = launcherBoxSize(petSize);
      const next = clampLauncherPosition({
        x: dragState.originX + event.clientX - dragState.startX,
        y: dragState.originY + event.clientY - dragState.startY,
      }, boxSize, boxSize);
      setPosition(next);
      saveLauncherPosition(next);

      // Browsers fire click after pointerup. Suppress only that click after dragging.
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 120);
    }

    dragRef.current = null;
    setDragging(false);
  };

  const beginResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = launcherRef.current?.getBoundingClientRect();
    const originX = rect?.left ?? position?.x ?? 0;
    const originY = rect?.top ?? position?.y ?? 0;
    resizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originSize: petSize,
      originX,
      originY,
      moved: false,
    };
    setResizing(true);
    setPosition({ x: originX, y: originY });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    const resizeState = resizeRef.current;
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - resizeState.startX;
    const deltaY = event.clientY - resizeState.startY;
    const hasMoved = Math.hypot(deltaX, deltaY) >= DRAG_THRESHOLD;
    if (!resizeState.moved && !hasMoved) return;

    resizeState.moved = true;
    suppressClickRef.current = true;
    event.preventDefault();
    event.stopPropagation();
    const nextSize = clampLauncherSize(resizeState.originSize + Math.max(deltaX, deltaY));
    const boxSize = launcherBoxSize(nextSize);
    setPetSize(nextSize);
    setPosition(clampLauncherPosition({ x: resizeState.originX, y: resizeState.originY }, boxSize, boxSize));
  };

  const endResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    const resizeState = resizeRef.current;
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.releasePointerCapture(event.pointerId);

    const deltaX = event.clientX - resizeState.startX;
    const deltaY = event.clientY - resizeState.startY;
    const nextSize = clampLauncherSize(resizeState.originSize + Math.max(deltaX, deltaY));
    const boxSize = launcherBoxSize(nextSize);
    const nextPosition = clampLauncherPosition({ x: resizeState.originX, y: resizeState.originY }, boxSize, boxSize);
    setPetSize(nextSize);
    setPosition(nextPosition);
    saveLauncherSize(nextSize);
    saveLauncherPosition(nextPosition);

    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 120);
    resizeRef.current = null;
    setResizing(false);
  };

  const cancelResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    const resizeState = resizeRef.current;
    if (resizeState?.pointerId === event.pointerId) {
      event.currentTarget.releasePointerCapture(event.pointerId);
      resizeRef.current = null;
      setResizing(false);
    }
  };

  const cancelDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const dragState = dragRef.current;
    if (dragState?.pointerId === event.pointerId) {
      event.currentTarget.releasePointerCapture(event.pointerId);
      dragRef.current = null;
      setDragging(false);
    }
  };

  const handleClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onOpen();
  };

  const launcherStyle = position ? { left: position.x, top: position.y } : undefined;
  const petStyle = resolveAssistantPetStyle(petStyles, selectedPetStyleId);
  const boxSize = launcherBoxSize(petSize);

  return (
    <div
      ref={launcherRef}
      className={(position ? "fixed" : "fixed bottom-5 right-5") + " group z-[70] touch-none select-none"}
      style={{ ...launcherStyle, width: boxSize, height: boxSize }}
    >
      <button
        type="button"
        onClick={handleClick}
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={cancelDrag}
        className={(dragging ? "cursor-grabbing transition-none" : "cursor-grab transition-transform hover:-translate-y-1 hover:scale-[1.02]") + " absolute left-0 top-0 flex touch-none items-end justify-center overflow-visible rounded-[24px] bg-transparent p-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-sky-500/30"}
        style={{ width: petSize, height: petSize }}
        title="打开 AI 小助手"
        aria-label="打开 AI 小助手"
      >
        <span className="pointer-events-none relative z-10 flex h-full w-full items-end justify-center overflow-visible">
          {petStyle ? (
            <AssistantPetSprite petStyle={petStyle} size={petSize} frameScale={1.08} alt={petStyle.name} />
          ) : (
            <span className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-neutral-950 text-white dark:bg-white dark:text-neutral-950">
              <Bot className="h-8 w-8" />
            </span>
          )}
        </span>
      </button>

      <button
        type="button"
        onPointerDown={beginResize}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        onPointerCancel={cancelResize}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        className={(resizing ? "scale-105 cursor-nwse-resize border-neutral-900 bg-neutral-950 text-white" : "cursor-nwse-resize border-neutral-200 bg-white/95 text-neutral-500 hover:border-neutral-900 hover:bg-neutral-950 hover:text-white dark:border-white/10 dark:bg-[#202126]/95 dark:text-neutral-200 dark:hover:bg-white dark:hover:text-neutral-950") + " absolute bottom-0 right-0 z-20 flex h-7 w-7 items-center justify-center rounded-full border transition"}
        title="拖动缩放助手"
        aria-label="拖动缩放助手"
      >
        <ArrowDownRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
