import type { RunParams } from "./types";

export type RunPromptReferenceKind = "image" | "video" | "audio";

export interface RunPromptReference {
  key: string;
  kind: RunPromptReferenceKind;
  index: number;
  label: string;
  source: string;
}

export type RunPromptPart =
  | { kind: "text"; value: string }
  | { kind: "reference"; value: RunPromptReference };

const KIND_LABEL: Record<RunPromptReferenceKind, string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
};

const TOKEN_SPLIT_RE = /((?:图片|视频|音频)\d+(?!\d))/g;

/**
 * Reconstruct the same per-media numbering used by the Studio composer.
 * i2v snapshots may contain the first frame in both imageRefs and firstFrame,
 * so the tool-specific selection below deliberately avoids displaying it twice.
 */
export function runPromptReferences(params: RunParams | undefined): RunPromptReference[] {
  if (!params) return [];
  const refs: RunPromptReference[] = [];
  const counts: Record<RunPromptReferenceKind, number> = { image: 0, video: 0, audio: 0 };
  const append = (kind: RunPromptReferenceKind, sources: Array<string | undefined>) => {
    sources.forEach((source) => {
      if (!source) return;
      const index = ++counts[kind];
      refs.push({
        key: `${kind}-${index}-${source}`,
        kind,
        index,
        label: `${KIND_LABEL[kind]}${index}`,
        source,
      });
    });
  };

  const imageSources = params.tool === "flf"
    ? [params.firstFrame, params.lastFrame]
    : params.imageRefs?.length
      ? params.imageRefs
      : [params.firstFrame, params.lastFrame];
  append("image", imageSources);
  append("video", params.videoRefs ?? []);
  append("audio", params.audioRefs ?? []);
  return refs;
}

/** Replace only tokens that have a matching persisted reference. */
export function splitRunPrompt(
  prompt: string,
  refs: RunPromptReference[],
): RunPromptPart[] {
  const byLabel = new Map(refs.map((ref) => [ref.label, ref]));
  return (prompt || "").split(TOKEN_SPLIT_RE).filter(Boolean).map((value) => {
    const ref = byLabel.get(value);
    return ref ? { kind: "reference", value: ref } : { kind: "text", value };
  });
}
