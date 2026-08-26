"use client";

import {
  cloneElement,
  Fragment,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEventHandler,
  type ReactNode,
} from "react";
import { Ellipsis } from "lucide-react";
import type { CanvasNodeFeatureKey } from "@/types/canvas-node-config";

export interface ConfigurableNodeToolbarAction {
  key: CanvasNodeFeatureKey;
  /** 相邻动作分组变化时自动插入分隔线。 */
  group: "creative" | "process" | "media";
  /**
   * 点击动作后是否收起“更多”。带有自身二级菜单的动作需要保持展开，
   * 否则 React 会在二级菜单收到点击后立刻卸载它。
   */
  closeOverflowOnSelect?: boolean;
  /** 纯图标动作进入“更多”后显示的文字标签。 */
  overflowLabel?: string;
  content: ReactNode;
}

interface Props {
  featureKeys: readonly CanvasNodeFeatureKey[];
  actions: readonly ConfigurableNodeToolbarAction[];
  onMouseDown?: MouseEventHandler<HTMLDivElement>;
  ariaLabel?: string;
  /** 超过该数量后的能力按后台顺序收进“更多”。 */
  maxPrimaryActions?: number;
}

/**
 * 配置驱动的节点顶部功能条。后台只控制已注册 key 的选择和顺序；未知 key
 * 找不到本地 action 时会被忽略，不会被当作 JSX、handler 或脚本执行。
 */
export function ConfigurableNodeToolbar({
  featureKeys,
  actions,
  onMouseDown,
  ariaLabel = "节点功能",
  maxPrimaryActions,
}: Props) {
  const [overflowState, setOverflowState] = useState({ open: false, signature: "" });
  const [viewportCap, setViewportCap] = useState(Number.POSITIVE_INFINITY);
  const overflowRef = useRef<HTMLDivElement>(null);
  const overflowButtonRef = useRef<HTMLButtonElement>(null);
  const registry = new Map(actions.map((action) => [action.key, action]));
  const ordered = featureKeys
    .map((key) => registry.get(key))
    .filter((action): action is ConfigurableNodeToolbarAction => action != null);
  const primaryLimit = maxPrimaryActions == null
    ? ordered.length
    : Math.max(0, maxPrimaryActions);
  // featureKeys is the administrator-authored order. Do not silently regroup
  // media actions here; doing so makes the configuration UI lie.
  const responsivePrimaryLimit = Math.min(primaryLimit, viewportCap);
  const primaryActions = ordered.slice(0, responsivePrimaryLimit);
  const overflowActions = ordered.slice(responsivePrimaryLimit);
  const overflowSignature = overflowActions.map((action) => action.key).join("\u0000");
  const overflowOpen = overflowActions.length > 0
    && overflowState.open
    && overflowState.signature === overflowSignature;

  useEffect(() => {
    const update = () => {
      const width = window.innerWidth;
      setViewportCap(
        width < 420 ? 2 : width < 720 ? 3 : width < 1_000 ? 6 : Number.POSITIVE_INFINITY,
      );
    };
    update();
    window.addEventListener("resize", update, { passive: true });
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (!overflowOpen) return;
    const closeOnOutside = (event: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(event.target as Node)) {
        setOverflowState({ open: false, signature: overflowSignature });
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOverflowState({ open: false, signature: overflowSignature });
        overflowButtonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [overflowOpen, overflowSignature]);

  useEffect(() => {
    if (!overflowOpen) return;
    const frame = requestAnimationFrame(() => {
      overflowRef.current?.querySelector<HTMLButtonElement>("[data-toolbar-overflow] button")?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [overflowOpen]);

  const handleOverflowKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
    ).filter((button) => button.offsetParent !== null);
    if (buttons.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : event.key === "ArrowDown"
          ? (currentIndex + 1 + buttons.length) % buttons.length
          : (currentIndex - 1 + buttons.length) % buttons.length;
    buttons[nextIndex]?.focus();
  };

  const renderOverflowContent = (action: ConfigurableNodeToolbarAction) => {
    if (!action.overflowLabel || !isValidElement(action.content)) {
      return action.content;
    }
    const element = action.content as ReactElement<{ children?: ReactNode }>;
    return cloneElement(
      element,
      undefined,
      <>
        {element.props.children}
        <span className="truncate">{action.overflowLabel}</span>
      </>,
    );
  };

  if (ordered.length === 0) return null;

  return (
    <div
      onMouseDown={onMouseDown}
      aria-label={ariaLabel}
      className="flex items-center gap-0.5 whitespace-nowrap rounded-[18px] border border-neutral-200/80 bg-white px-2 py-1.5 text-sm text-neutral-700 shadow-lg [&>*]:shrink-0 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
      style={{ maxWidth: "calc(100vw - 16px)" }}
    >
      {primaryActions.map((action, index) => (
        <Fragment key={action.key}>
          {index > 0 && primaryActions[index - 1].group !== action.group ? (
            <span className="mx-1 h-5 w-px bg-neutral-200 dark:bg-neutral-700" aria-hidden />
          ) : null}
          {action.content}
        </Fragment>
      ))}
      {overflowActions.length > 0 ? (
        <div ref={overflowRef} className="relative">
          <button
            ref={overflowButtonRef}
            type="button"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              setOverflowState((current) => ({
                open: !(current.open && current.signature === overflowSignature),
                signature: overflowSignature,
              }));
            }}
            className={`flex h-8 w-8 items-center justify-center rounded-xl transition-colors ${overflowOpen ? "bg-neutral-100 dark:bg-neutral-800" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
            title="更多功能"
            aria-label="更多功能"
            aria-expanded={overflowOpen}
            aria-haspopup="true"
          >
            <Ellipsis className="h-4 w-4" aria-hidden />
          </button>
          {overflowOpen ? (
            <div
              role="group"
              aria-label="更多节点功能"
              data-toolbar-overflow
              onMouseDown={(event) => event.stopPropagation()}
              onKeyDown={handleOverflowKeyDown}
              className="absolute right-0 top-full z-50 mt-2 w-44 animate-in overflow-visible rounded-2xl border border-neutral-200/80 bg-white/95 p-1.5 shadow-[0_18px_50px_rgba(15,23,42,0.18)] backdrop-blur-xl duration-100 fade-in-0 zoom-in-95 motion-reduce:animate-none dark:border-white/10 dark:bg-neutral-900/95 dark:shadow-black/55"
            >
              {overflowActions.map((action, index) => (
                <Fragment key={action.key}>
                  {index > 0 && overflowActions[index - 1].group !== action.group ? (
                    <div className="mx-2 my-1.5 h-px bg-neutral-200/80 dark:bg-neutral-700/80" aria-hidden />
                  ) : null}
                  <div
                    className="w-full [&_svg]:shrink-0 [&>button]:flex [&>button]:h-9 [&>button]:w-full [&>button]:items-center [&>button]:justify-start [&>button]:gap-2.5 [&>button]:rounded-xl [&>button]:px-2.5 [&>button]:py-0 [&>button]:text-[13px] [&>button]:transition-colors [&>button]:focus-visible:outline-none [&>button]:focus-visible:ring-2 [&>button]:focus-visible:ring-blue-500/35 [&>div]:w-full [&>div>button]:flex [&>div>button]:h-9 [&>div>button]:w-full [&>div>button]:items-center [&>div>button]:justify-start [&>div>button]:rounded-xl [&>div>button]:px-2.5 [&>div>button]:py-0 [&>div>button]:text-[13px]"
                    onClickCapture={() => {
                      if (action.closeOverflowOnSelect !== false) {
                        setOverflowState({ open: false, signature: overflowSignature });
                      }
                    }}
                  >
                    {renderOverflowContent(action)}
                  </div>
                </Fragment>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
