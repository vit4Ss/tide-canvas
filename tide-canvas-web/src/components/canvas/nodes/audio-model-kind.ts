export type AudioModelKind = "speech" | "music" | "suno" | "sfx";

/** t2a describes an audio endpoint, not support for Suno's lyrics/clip tasks.
 * Model families match the catalog descriptions in cmd/fixdesc/main.go. */
export function audioModelKind(model: { modelId?: string; name?: string }, modes: string[], hasVoices = false): AudioModelKind {
  const identity = `${model.modelId ?? ""} ${model.name ?? ""}`;
  if (modes.includes("sfx") || /sfx|音效/i.test(identity)) return "sfx";
  if (modes.includes("tts") || modes.includes("speech") || /tts|speech|mai[-_ ]voice|语音合成/i.test(identity)) return "speech";
  if (/suno/i.test(identity)) return "suno";
  if (hasVoices) return "speech";
  if (/lyria/i.test(identity) || modes.includes("t2a")) return "music";
  return "speech";
}
