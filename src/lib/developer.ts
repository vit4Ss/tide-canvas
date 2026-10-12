export type EndpointKey = "models" | "generate" | "task" | "chat" | "responses";
export const ENDPOINTS: Record<EndpointKey, { label: string; method: "GET" | "POST"; path: string; description: string }> = {
  models: { label: "List models", method: "GET", path: "/api/open/v1/models", description: "Discover the models and capabilities available to your API key." },
  generate: { label: "Create a generation", method: "POST", path: "/api/open/v1/generations", description: "Submit an image, video, audio or 3D task. This request uses account credits." },
  task: { label: "Get a task", method: "GET", path: "/api/open/v1/tasks/{id}", description: "Retrieve the status and results of one of your generation tasks." },
  chat: { label: "Chat completions", method: "POST", path: "/api/integrations/v1/chat/completions", description: "Send an OpenAI-compatible chat request. Usage is billed by tokens." },
  responses: { label: "Responses API", method: "POST", path: "/api/integrations/v1/responses", description: "Use the Responses-compatible gateway with a model from its catalog." },
};
export function requestTemplate(endpoint: EndpointKey, modelId: string, media = "image") {
  if (endpoint === "generate") {
    if (media === "upscale") return { handler: "video_upscale", modelId, input: { videoUrl: "YOUR_OWNED_VIDEO_URL", targetResolution: "1080p", ...(modelId === "rh-upscale" ? { upscaleModel: "max", outputFps: "1x" } : {}) } };
    return { handler: media === "video" ? "text_to_video" : media === "audio" ? "text_to_audio" : media === "3d" ? "generate_3d" : "text_to_image", modelId, input: { prompt: media === "audio" ? "Warm cinematic piano, a gentle melody and a slow build." : media === "3d" ? "A sculptural ceramic vase with a flowing silhouette." : "A sculptural coastal house at golden hour, cinematic architectural photography." } };
  }
  if (endpoint === "responses") return { model: modelId, input: "Give me three imaginative starting points for a short film.", stream: false };
  return { model: modelId, messages: [{ role: "user", content: "Give me three imaginative starting points for a short film." }], stream: false };
}
export function parseRequestBody(value: string): Record<string, unknown> {
  const body = JSON.parse(value);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Request body must be a JSON object.");
  return body;
}
export function requestPath(endpoint: EndpointKey, taskId: string) {
  if (endpoint !== "task") return ENDPOINTS[endpoint].path;
  if (!taskId.trim()) throw new Error("Enter a task ID first.");
  return `/api/open/v1/tasks/${encodeURIComponent(taskId.trim())}`;
}
export function curlExample(origin: string, method: string, path: string, body?: string): string {
  const lines = [`curl '${origin}${path}'`, `  -H "Authorization: Bearer $FRAMELYN_API_KEY"`];
  if (method === "POST") { lines.push(`  -H 'Content-Type: application/json'`); lines.push(`  -d '${(body || "{}").replaceAll("'", "'\\''")}'`); }
  return lines.join(" \\\n");
}
