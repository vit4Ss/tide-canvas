"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { captureCanvasError } from "../../infrastructure/telemetry/canvas-telemetry";

interface CanvasErrorBoundaryProps {
  children: ReactNode;
  scope: "editor" | "node";
  resetKey?: unknown;
}

interface CanvasErrorBoundaryState {
  failed: boolean;
}

/** 将渲染异常限制在画布功能内，避免整站进入不可恢复的白屏。 */
export class CanvasErrorBoundary extends Component<
  CanvasErrorBoundaryProps,
  CanvasErrorBoundaryState
> {
  state: CanvasErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): CanvasErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    captureCanvasError("canvas.render.failed", error, {
      scope: this.props.scope,
      hasComponentStack: Boolean(info.componentStack),
    });
  }

  componentDidUpdate(previousProps: CanvasErrorBoundaryProps): void {
    if (this.state.failed && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  private retry = (): void => {
    this.setState({ failed: false });
  };

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    if (this.props.scope === "node") {
      return (
        <div
          role="alert"
          className="flex min-h-28 w-72 flex-col items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white p-4 text-center text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
        >
          <TriangleAlert className="h-4 w-4" aria-hidden />
          <span className="text-xs">此节点暂时无法显示</span>
          <button
            type="button"
            onClick={this.retry}
            className="rounded-md border border-neutral-200 px-2 py-1 text-xs hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            重试
          </button>
        </div>
      );
    }

    return (
      <div
        role="alert"
        className="absolute inset-0 z-50 grid place-items-center bg-neutral-50 p-6 dark:bg-neutral-950"
      >
        <div className="max-w-sm text-center">
          <TriangleAlert className="mx-auto h-5 w-5 text-amber-600 dark:text-amber-400" aria-hidden />
          <h1 className="mt-3 text-base font-semibold text-neutral-900 dark:text-neutral-100">
            画布渲染遇到问题
          </h1>
          <p className="mt-2 text-sm leading-6 text-neutral-500 dark:text-neutral-400">
            已隔离本次异常，项目数据不会因此被清除。可以先尝试重新渲染。
          </p>
          <button
            type="button"
            onClick={this.retry}
            className="mt-4 inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            重试画布渲染
          </button>
        </div>
      </div>
    );
  }
}
