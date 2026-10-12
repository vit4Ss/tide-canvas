import type { StudioModel } from "./api";
import { resolveImageToolPointCost, resolveVideoPointCost } from "./price-matrix.ts";

export type MediaType = "image" | "video" | "audio" | "3d" | "upscale";
export interface Reference { url: string; name: string; kind: "image" | "video" | "audio" }
export interface StudioSettings {
  media: MediaType; mode: string; prompt: string; resolution: string; ratio: string; quality: string; duration: string; count: number;
  refs: Reference[]; outputFps: string; upscaleModel: string; voice: string; lyrics: string; instrumental: boolean; enablePbr: boolean;
}
const modeLabels: Record<string, string> = { text_to_image: "Text to image", image_to_image: "Image to image", text_to_video: "Text to video", image_to_video: "Image to video", start_end_to_video: "First & last frame", reference_to_video: "Reference to video", text_to_audio: "Text to audio", generate_3d: "Create a 3D asset", video_upscale: "Enhance a video" };
const modeAliases: Record<string, string> = { t2i: "text_to_image", i2i: "image_to_image", t2v: "text_to_video", i2v: "image_to_video", keyframe: "start_end_to_video", first_last_frame: "start_end_to_video", omni_ref: "reference_to_video", multi_ref: "reference_to_video" };
export function modesFor(media: MediaType, model: StudioModel | null) {
  const defaults: Record<MediaType, string[]> = { image: ["text_to_image", "image_to_image"], video: ["text_to_video", "image_to_video", "start_end_to_video", "reference_to_video"], audio: ["text_to_audio"], "3d": ["generate_3d"], upscale: ["video_upscale"] };
  const configured = model?.config?.modes?.map((mode) => modeAliases[mode] || mode).filter((mode) => defaults[media].includes(mode)) || [];
  return (configured.length ? [...new Set(configured)] : defaults[media]).map((value) => ({ value, label: modeLabels[value] }));
}
export function mediaForHandler(handler: string): MediaType {
  if (handler === "video_upscale") return "upscale";
  if (handler === "generate_3d") return "3d";
  if (handler === "text_to_audio") return "audio";
  return handler.includes("video") ? "video" : "image";
}
export function buildGenerationInput(settings: StudioSettings, model: StudioModel): Record<string, unknown> {
  const { media, mode, refs } = settings;
  const images = refs.filter((ref) => ref.kind === "image").map((ref) => ref.url);
  const videos = refs.filter((ref) => ref.kind === "video").map((ref) => ref.url);
  const audio = refs.filter((ref) => ref.kind === "audio").map((ref) => ref.url);
  if (media === "upscale") return {
    videoUrl: videos[0], targetResolution: settings.resolution,
    ...(model.modelKey === "rh-upscale" ? { ...(settings.outputFps ? { outputFps: settings.outputFps } : {}), ...(settings.upscaleModel ? { upscaleModel: settings.upscaleModel } : {}) } : {}),
  };
  const input: Record<string, unknown> = { prompt: settings.prompt.trim() };
  if (settings.resolution) input.resolution = settings.resolution;
  if (settings.quality) input.quality = settings.quality;
  if (settings.ratio) input.aspectRatio = settings.ratio;
  if (media === "image") {
    if (!model.config?.hideBatchCount && settings.count > 1) input.batchCount = Math.min(Math.floor(settings.count), 4);
    if (mode === "image_to_image") { input.imageList = images; input.sourceImage = images[0]; }
  }
  if (media === "video") {
    if (settings.duration) input.duration = Number.parseInt(settings.duration, 10);
    if (mode === "image_to_video") input.imageUrl = images[0];
    if (mode === "start_end_to_video") input.imageList = images.slice(0, 2);
    if (mode === "reference_to_video") { if (images.length) input.imageList = images; if (videos.length) input.videoReferences = videos; if (audio.length) input.audioReferences = audio; }
  }
  if (media === "audio") {
    input.input = settings.prompt.trim();
    if (settings.voice) input.voice = settings.voice;
    if (settings.lyrics || settings.instrumental) input.extras = { ...(settings.lyrics ? { lyrics: settings.lyrics } : {}), ...(settings.instrumental ? { make_instrumental: true } : {}) };
  }
  if (media === "3d") { if (images.length) input.imageUrl = images[0]; input.enablePbr = settings.enablePbr; }
  return input;
}
export function validateReferences(settings: StudioSettings, model: StudioModel): string {
  const imageCount = settings.refs.filter((ref) => ref.kind === "image").length;
  if (settings.refs.length && ["text_to_image", "text_to_video"].includes(settings.mode)) return "Choose a reference-supported mode to use these files.";
  if (["image_to_video", "start_end_to_video"].includes(settings.mode) && settings.refs.some((ref) => ref.kind !== "image")) return "Choose reference-to-video to use video or audio references.";
  if (settings.mode === "image_to_image" && !imageCount) return "Add at least one reference image.";
  if (settings.mode === "image_to_video" && imageCount !== 1) return "Add exactly one source image for image-to-video.";
  if (settings.mode === "start_end_to_video" && imageCount !== 2) return "Add a first frame and a last frame.";
  if (settings.mode === "reference_to_video" && !settings.refs.length) return "Add a reference image, video or audio file.";
  if (settings.media === "upscale" && settings.refs.filter((ref) => ref.kind === "video").length !== 1) return "Add one source video to enhance.";
  if (settings.media === "image" && imageCount > (model.config?.maxRefImages || 16)) return "This model accepts fewer reference images. Remove some files.";
  if (settings.media === "3d" && imageCount > 1) return "Use a single reference image for this 3D request.";
  if (settings.mode === "reference_to_video") {
    if (imageCount && model.config?.omniRefImageEnabled === false) return "This model does not accept image references.";
    if (settings.refs.some((ref) => ref.kind === "video") && model.config?.omniRefVideoEnabled === false) return "This model does not accept video references.";
    if (settings.refs.some((ref) => ref.kind === "audio") && model.config?.omniRefAudioEnabled === false) return "This model does not accept audio references.";
    const limits = model.config?.refLimits;
    for (const kind of ["image", "video", "audio"] as const) {
      const limit = limits?.[`omniRef.${kind}Count`];
      if (limit && settings.refs.filter((ref) => ref.kind === kind).length > limit) return `This model accepts up to ${limit} ${kind} references.`;
    }
  }
  return "";
}
export function estimatedCost(model: StudioModel | null, settings: StudioSettings): number {
  if (!model) return 0;
  if (settings.media === "video") return resolveVideoPointCost(model.config, settings.duration, settings.resolution, model.pointCost);
  if (settings.media === "image") return resolveImageToolPointCost(model.config, buildGenerationInput(settings, model), model.pointCost);
  return Math.max(0, Number(model.pointCost) || 0);
}
export function resultUrls(meta: unknown, primary = ""): string[] {
  let parsed: unknown = meta;
  if (typeof parsed === "string") { try { parsed = JSON.parse(parsed); } catch { parsed = {}; } }
  const urls = parsed && typeof parsed === "object" && "urls" in parsed && Array.isArray(parsed.urls) ? parsed.urls.filter((url): url is string => typeof url === "string") : [];
  return [...new Set([primary, ...urls].filter(Boolean))].filter((url) => /^https?:\/\//i.test(url) || url.startsWith("/"));
}
