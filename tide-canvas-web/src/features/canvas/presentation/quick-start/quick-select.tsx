"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { defaultOptionLabel } from "../../application/quick-start/quick-start-policy";
import styles from "@/components/canvas/styles/canvas-quick-start.module.css";

interface QuickSelectProps {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  disabled?: boolean;
  formatOption?: (value: string) => string;
  icon?: ReactNode;
  dark?: boolean;
}

export function QuickSelect({
  label,
  value,
  options,
  onChange,
  disabled,
  formatOption,
  icon,
  dark = false,
}: QuickSelectProps) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [panelPosition, setPanelPosition] = useState({
    left: 12,
    top: 12,
    width: 160,
    maxHeight: 240,
  });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const optionLabel = (option: string): string => (
    formatOption?.(option) ?? defaultOptionLabel(option)
  );
  const currentLabel = optionLabel(value);
  const unavailable = disabled || options.length === 0;

  const focusNextToolbarControl = (backward: boolean): void => {
    const focusable = Array.from(document.querySelectorAll<HTMLElement>(
      'a[href], button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => (
      !panelRef.current?.contains(element)
      && element.getClientRects().length > 0
      && getComputedStyle(element).visibility !== "hidden"
    ));
    const triggerIndex = triggerRef.current ? focusable.indexOf(triggerRef.current) : -1;
    if (triggerIndex < 0 || focusable.length === 0) return;
    const nextIndex = backward ? triggerIndex - 1 : triggerIndex + 1;
    focusable[(nextIndex + focusable.length) % focusable.length]?.focus();
  };

  const positionPanel = (): void => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const gutter = 12;
    const gap = 8;
    const panelWidth = Math.min(184, Math.max(152, Math.ceil(rect.width) + 32));
    const estimatedHeight = Math.min(240, options.length * 38 + 12);
    const spaceBelow = window.innerHeight - rect.bottom - gap - gutter;
    const spaceAbove = rect.top - gap - gutter;
    const nextOpenUp = spaceBelow < estimatedHeight && spaceAbove > spaceBelow;
    const availableHeight = nextOpenUp ? spaceAbove : spaceBelow;
    setOpenUp(nextOpenUp);
    setPanelPosition({
      left: Math.min(
        Math.max(gutter, Math.round(rect.left)),
        Math.max(gutter, window.innerWidth - panelWidth - gutter),
      ),
      top: Math.round(nextOpenUp ? rect.top - gap : rect.bottom + gap),
      width: panelWidth,
      maxHeight: Math.max(64, Math.min(240, availableHeight)),
    });
  };

  const openMenu = (preferredIndex?: number): void => {
    if (unavailable) return;
    const selectedIndex = Math.max(0, options.indexOf(value));
    setActiveIndex(preferredIndex ?? selectedIndex);
    positionPanel();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const focusFrame = requestAnimationFrame(() => {
      panelRef.current
        ?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]')
        ?.focus();
    });
    const closeOutside = (event: PointerEvent): void => {
      const target = event.target;
      if (
        target instanceof Node
        && (triggerRef.current?.contains(target) || panelRef.current?.contains(target))
      ) return;
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      requestAnimationFrame(() => triggerRef.current?.focus());
    };
    const closeOnViewportResize = (): void => setOpen(false);
    const closeOnViewportScroll = (event: Event): void => {
      const target = event.target;
      if (target instanceof Node && panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("keydown", closeOnEscape, true);
    window.addEventListener("resize", closeOnViewportResize);
    window.addEventListener("scroll", closeOnViewportScroll, true);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("keydown", closeOnEscape, true);
      window.removeEventListener("resize", closeOnViewportResize);
      window.removeEventListener("scroll", closeOnViewportScroll, true);
    };
  }, [open]);

  const handlePanelKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Tab") {
      event.preventDefault();
      setOpen(false);
      requestAnimationFrame(() => focusNextToolbarControl(event.shiftKey));
      return;
    }
    const items = panelRef.current
      ? Array.from(panelRef.current.querySelectorAll<HTMLButtonElement>('[role="option"]'))
      : [];
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex = currentIndex;
    if (event.key === "ArrowDown") nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    else if (event.key === "ArrowUp") nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = items.length - 1;
    else return;
    event.preventDefault();
    setActiveIndex(nextIndex);
    items[nextIndex]?.focus();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.selectControl}
        title={`${label}：${currentLabel}`}
        aria-label={`${label}，当前 ${currentLabel}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        disabled={unavailable}
        onClick={() => {
          if (open) setOpen(false);
          else openMenu();
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          if (open) return;
          const selectedIndex = Math.max(0, options.indexOf(value));
          openMenu(event.key === "ArrowUp" ? Math.max(0, selectedIndex) : selectedIndex);
        }}
      >
        {icon && <span className={styles.controlIcon} aria-hidden>{icon}</span>}
        <span className={styles.controlLabel}>{label}</span>
        <span className={styles.selectValue}>{options.length ? currentLabel : "模型默认"}</span>
        <ChevronDown
          aria-hidden
          className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`}
        />
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div
          id={panelId}
          ref={panelRef}
          role="listbox"
          aria-label={label}
          className={`${styles.selectMenu} ${dark ? styles.selectMenuDark : ""} ${openUp ? styles.selectMenuOpenUp : ""}`}
          style={{
            left: panelPosition.left,
            top: panelPosition.top,
            width: panelPosition.width,
            maxHeight: panelPosition.maxHeight,
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onKeyDown={handlePanelKeyDown}
        >
          {options.map((option, index) => {
            const selected = option === value;
            return (
              <button
                key={option}
                type="button"
                role="option"
                aria-selected={selected}
                tabIndex={index === activeIndex ? 0 : -1}
                className={`${styles.selectOption} ${selected ? styles.selectOptionActive : ""}`}
                onFocus={() => setActiveIndex(index)}
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                  requestAnimationFrame(() => triggerRef.current?.focus());
                }}
              >
                <span>{optionLabel(option)}</span>
                {selected && <Check aria-hidden className={styles.selectCheck} />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
