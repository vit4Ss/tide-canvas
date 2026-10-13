import type { StudioModel } from "./api";
import type { MediaType } from "./studio";

export function audioKind(model: StudioModel | null): "music" | "sound" | "speech" | "generic" {
  const key = `${model?.modelKey || ""} ${model?.name || ""}`.toLowerCase();
  if (/sfx|sound.effect/.test(key)) return "sound";
  if (/suno|music/.test(key)) return "music";
  if (/tts|speech|elevenlabs|voice/.test(key)) return "speech";
  return "generic";
}
const ideas: Record<MediaType, string[]> = {
  image: ["An unbranded perfume bottle on pale stone, warm studio lighting, clean shadows and detailed glass reflections.", "A quiet alpine lake at dawn, soft mist, natural colors, wide landscape photograph."],
  video: ["A slow tracking shot past an unbranded perfume bottle on a stone table. Morning light moves across the glass. Keep the camera steady and the product consistent.", "A wide view of ocean waves at sunset, with a gentle forward camera move and continuous natural motion."],
  audio: ["A warm instrumental piano piece, 80 BPM, gentle strings, a slow build and a calm ending.", "An upbeat acoustic pop song about starting a new creative chapter, with a memorable chorus and warm vocals."],
  "3d": ["A ceramic vase with a flowing silhouette and a matte ivory surface, a single isolated object.", "A small wooden stool with four legs and a round seat, clean topology and natural wood materials."],
  upscale: [],
};
export function promptIdea(media: MediaType, model: StudioModel | null, index = 0) {
  if (media === "audio" && audioKind(model) === "sound") return "Gentle rain on a window, distant rolling thunder, a quiet indoor atmosphere, no music or voices.";
  if (media === "audio" && audioKind(model) === "speech") return "Welcome. Let’s make room for your next idea.";
  const options = ideas[media];
  return options[index % options.length] || "";
}
export function modelGuidance(model: StudioModel) {
  const config = model.config;
  if (model.type === "audio") return { music: "Songs and instrumental music. Describe the style, mood and tempo; lyrics are optional.", sound: "Sound effects and ambient audio. Describe the sound source and surrounding atmosphere.", speech: "Spoken audio. Enter the words to say and use a voice supported by this model.", generic: "Audio from a text description. Check the model’s supported inputs before creating." }[audioKind(model)];
  if (model.type === "upscale") return model.modelKey === "rh-upscale" ? "Enhance existing video and optionally interpolate frames. Choose the enhancement level and output frame rate." : "Increase the resolution of an existing video. Upload a source clip to verify its credit cost.";
  if (model.type === "3d") return /marble|world.?labs/i.test(model.modelKey) ? "Create a spatial scene. Result formats vary; use a compatible viewer for scene outputs." : "Create a 3D object from a prompt or reference. Compatible GLB and glTF results can be inspected in your library.";
  const resolutions = config?.resolutions?.map((r) => r.toUpperCase()).join(", ");
  const durations = (config?.durations || []).map((d) => Number.parseFloat(d)).filter(Number.isFinite);
  return `${model.type === "video" ? "Create moving scenes" : "Create still images"}${resolutions ? ` at ${resolutions}` : ""}${durations.length ? `, with clips from ${Math.min(...durations)} to ${Math.max(...durations)} seconds` : ""}. ${config?.modes?.length ? `Supported workflows: ${config.modes.map(m => ({t2i:"text to image",i2i:"image to image",t2v:"text to video",i2v:"image to video",keyframe:"first/last frames",omni_ref:"multiple references"})[m] || m.replaceAll("_", " ")).join(", ")}.` : "Select a workflow in the studio to see its input requirements."}`;
}
