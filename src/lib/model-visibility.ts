export const MEDIA_MODEL_TYPES = ["image", "video", "audio", "3d", "upscale"] as const;
// The backend's video history filter already includes video enhancement tasks.
// Query disjoint categories so enhancement records are not counted twice.
export const MEDIA_HISTORY_TYPES = ["image", "video", "audio", "3d"] as const;

export function isMediaModel(model: { type?: unknown }) {
  return MEDIA_MODEL_TYPES.some((type) => type === model.type);
}

export function isTextTask(task: { handler?: unknown }) {
  return task.handler === "assistant_chat" || task.handler === "skill_text_completion";
}
