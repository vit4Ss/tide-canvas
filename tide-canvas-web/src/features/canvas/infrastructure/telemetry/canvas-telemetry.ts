export type CanvasTelemetryLevel = "info" | "warning" | "error";

export type CanvasTelemetryValue = string | number | boolean | null;

export interface CanvasTelemetryEvent {
  name: string;
  level: CanvasTelemetryLevel;
  timestamp: number;
  attributes?: Readonly<Record<string, CanvasTelemetryValue>>;
  error?: Error;
}

export interface CanvasTelemetrySink {
  capture(event: CanvasTelemetryEvent): void;
}

let activeSink: CanvasTelemetrySink | null = null;

/**
 * 注册监控实现。当前不绑定云厂商或 SDK；未来接入 Sentry、阿里云 ARMS 等时，
 * 只需在画布入口配置一次适配器，不必让业务模块依赖具体平台。
 */
export function configureCanvasTelemetry(sink: CanvasTelemetrySink | null): void {
  activeSink = sink;
}

function captureSafely(event: CanvasTelemetryEvent): void {
  try {
    activeSink?.capture(event);
  } catch {
    // 监控是旁路能力，SDK 初始化或传输异常绝不能改变保存、恢复和渲染结果。
  }
}

export function captureCanvasEvent(
  name: string,
  attributes?: Readonly<Record<string, CanvasTelemetryValue>>,
): void {
  captureSafely({ name, level: "info", timestamp: Date.now(), attributes });
}

export function captureCanvasWarning(
  name: string,
  attributes?: Readonly<Record<string, CanvasTelemetryValue>>,
): void {
  captureSafely({ name, level: "warning", timestamp: Date.now(), attributes });
}

export function captureCanvasError(
  name: string,
  cause: unknown,
  attributes?: Readonly<Record<string, CanvasTelemetryValue>>,
): void {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  captureSafely({ name, level: "error", timestamp: Date.now(), attributes, error });
}
