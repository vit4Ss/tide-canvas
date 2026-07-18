"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { detectAssistantPetSpriteFromImageUrl } from "@/lib/assistant-pet-sprite";
import type { AssistantPetSpriteMeta, AssistantPetStyle } from "@/types/assistant";

interface AssistantPetSpriteProps {
  petStyle?: AssistantPetStyle | null;
  imageUrl?: string;
  sprite?: AssistantPetSpriteMeta;
  actionId?: string;
  size?: number;
  frameScale?: number;
  animate?: boolean;
  className?: string;
  containerStyle?: CSSProperties;
  fallback?: ReactNode;
  alt?: string;
}

const detectionCache = new Map<string, Promise<AssistantPetSpriteMeta | undefined>>();

function detectCached(imageUrl: string, hint?: string) {
  const key = `${imageUrl}::${hint ?? ""}`;
  const cached = detectionCache.get(key);
  if (cached) return cached;
  const promise = detectAssistantPetSpriteFromImageUrl(imageUrl, hint).catch(() => undefined);
  detectionCache.set(key, promise);
  return promise;
}

function pickAction(sprite: AssistantPetSpriteMeta, actionId?: string) {
  return sprite.actions.find((action) => action.id === actionId) ??
    sprite.actions.find((action) => action.id === sprite.defaultAction) ??
    sprite.actions[0];
}

export function useResolvedAssistantPetSprite(petStyle?: AssistantPetStyle | null, disabled = false) {
  const [detectedSprite, setDetectedSprite] = useState<AssistantPetSpriteMeta | undefined>();
  const [detecting, setDetecting] = useState(false);
  const imageUrl = petStyle?.imageUrl ?? "";
  const explicitSprite = petStyle?.sprite;

  useEffect(() => {
    setDetectedSprite(undefined);
    if (disabled || explicitSprite || !imageUrl) {
      setDetecting(false);
      return;
    }

    let cancelled = false;
    setDetecting(true);
    detectCached(imageUrl, petStyle?.name)
      .then((sprite) => {
        if (!cancelled) setDetectedSprite(sprite);
      })
      .finally(() => {
        if (!cancelled) setDetecting(false);
      });

    return () => {
      cancelled = true;
    };
  }, [disabled, explicitSprite, imageUrl, petStyle?.name]);

  return {
    sprite: explicitSprite ?? detectedSprite,
    detecting,
    source: explicitSprite ? "saved" : detectedSprite ? "detected" : null,
  } as const;
}

export function AssistantPetSprite({
  petStyle,
  imageUrl,
  sprite,
  actionId,
  size = 56,
  frameScale = 1,
  animate = true,
  className,
  containerStyle,
  fallback,
  alt = "",
}: AssistantPetSpriteProps) {
  const disabledAutoDetect = Boolean(sprite);
  const resolved = useResolvedAssistantPetSprite(petStyle, disabledAutoDetect);
  const activeSprite = sprite ?? resolved.sprite;
  const src = imageUrl ?? petStyle?.imageUrl ?? "";
  const action = useMemo(() => (activeSprite ? pickAction(activeSprite, actionId) : undefined), [activeSprite, actionId]);
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    setFrameIndex(0);
  }, [action?.id, src]);

  useEffect(() => {
    if (!animate || !action || action.count <= 1) return;
    const fps = Math.min(30, Math.max(1, action.fps ?? activeSprite?.fps ?? 8));
    const timer = window.setInterval(() => {
      setFrameIndex((current) => (current + 1) % action.count);
    }, 1000 / fps);
    return () => window.clearInterval(timer);
  }, [action, activeSprite?.fps, animate]);

  if (!src) {
    return (
      <span className={className} style={{ width: size, height: size, ...containerStyle }}>
        {fallback}
      </span>
    );
  }

  if (!activeSprite || !action) {
    return (
      <span
        className={className}
        style={{
          width: size,
          height: size,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          ...containerStyle,
        }}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
        />
      </span>
    );
  }

  const frameWidth = Math.max(1, activeSprite.frameWidth);
  const frameHeight = Math.max(1, activeSprite.frameHeight);
  const aspect = frameWidth / frameHeight;
  const innerWidth = aspect >= 1 ? size : Math.round(size * aspect);
  const innerHeight = aspect >= 1 ? Math.round(size / aspect) : size;
  const column = Math.min(activeSprite.columns - 1, action.start + (frameIndex % action.count));
  const row = Math.min(activeSprite.rows - 1, Math.max(0, action.row));
  const xPosition = activeSprite.columns <= 1 ? 0 : (column / (activeSprite.columns - 1)) * 100;
  const yPosition = activeSprite.rows <= 1 ? 0 : (row / (activeSprite.rows - 1)) * 100;

  return (
    <span
      className={className}
      style={{
        width: size,
        height: size,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        ...containerStyle,
      }}
      aria-label={alt}
    >
      <span
        aria-hidden="true"
        style={{
          width: innerWidth,
          height: innerHeight,
          display: "block",
          backgroundImage: `url("${src.replace(/"/g, "%22")}")`,
          backgroundRepeat: "no-repeat",
          backgroundSize: `${activeSprite.columns * 100}% ${activeSprite.rows * 100}%`,
          backgroundPosition: `${xPosition}% ${yPosition}%`,
          imageRendering: "pixelated",
          transform: frameScale === 1 ? undefined : `scale(${frameScale})`,
          transformOrigin: "center bottom",
        }}
      />
    </span>
  );
}
