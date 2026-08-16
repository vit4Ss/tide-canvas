import type { ModelConfig } from "@/types/admin-models";

export type OmniReferenceKind = "image" | "video" | "audio";

const SUPPORT_FIELD: Record<OmniReferenceKind, keyof ModelConfig> = {
  image: "omniRefImageEnabled",
  video: "omniRefVideoEnabled",
  audio: "omniRefAudioEnabled",
};

/** Legacy model configs predate these switches, so only false disables a kind. */
export function supportsOmniReference(
  config: Partial<ModelConfig> | null | undefined,
  kind: OmniReferenceKind,
): boolean {
  return config?.[SUPPORT_FIELD[kind]] !== false;
}

export function supportedOmniReferenceKinds(
  config: Partial<ModelConfig> | null | undefined,
): OmniReferenceKind[] {
  return (["image", "video", "audio"] as const).filter((kind) =>
    supportsOmniReference(config, kind),
  );
}
