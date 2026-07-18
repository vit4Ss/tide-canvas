"use client";

import { useCallback, useRef, type CSSProperties, type ReactNode } from "react";
import { Popover } from "@mantine/core";
import { ChevronDown, RectangleHorizontal, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDismissibleCanvasOverlay, useExclusiveCanvasOverlay } from "../../canvas-overlay-coordinator";
import styles from "../styles/parameter-dropdown.module.css";
import type { ImageQuality, ParamSectionProps, QualityRatioValue, RatioOption } from "../types/quality-ratio";
import {
  CLARITY_OPTIONS,
  QUALITY_OPTIONS,
  RATIO_OPTIONS,
  buildQualityRatioSummary,
  getRatioShapeSize,
} from "../utils/quality-ratio";

interface QualityRatioDropdownProps {
  value: QualityRatioValue;
  onChange: (value: QualityRatioValue) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  qualities?: readonly string[];
  clarities?: readonly string[];
  ratios?: readonly string[];
  batchCount?: number;
  compact?: boolean;
  composer?: boolean;
}

// 中文注释：画质、清晰度和尺寸的组合下拉，首页和画布节点共用同一套交互与视觉。
export function QualityRatioDropdown({
  value,
  onChange,
  open,
  onOpenChange,
  qualities,
  clarities,
  ratios,
  batchCount,
  compact = false,
  composer = false,
}: QualityRatioDropdownProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeOverlay = useCallback(() => onOpenChange(false), [onOpenChange]);
  const announceOpen = useExclusiveCanvasOverlay(open, closeOverlay, "quality-ratio");
  useDismissibleCanvasOverlay(open, closeOverlay, [triggerRef, panelRef]);
  const qualityOptions = qualities ? QUALITY_OPTIONS.filter((option) => qualities.includes(option.value)) : QUALITY_OPTIONS;
  const clarityOptions = clarities ? CLARITY_OPTIONS.filter((option) => clarities.includes(option)) : CLARITY_OPTIONS;
  const ratioOptions = ratios ? RATIO_OPTIONS.filter((option) => ratios.includes(option.value)) : RATIO_OPTIONS;

  const dropdownPanel = (
    <div className={styles.panelInner} onMouseDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
      {qualityOptions.length > 0 && (
        <ParamSection title={composer ? "图像质量" : "画质"}>
          <SegmentedRow count={qualityOptions.length}>
            {qualityOptions.map((option) => (
              <SegmentButton key={option.value} active={value.quality === option.value} onClick={() => onChange({ ...value, quality: option.value })}>
                {option.label}
              </SegmentButton>
            ))}
          </SegmentedRow>
        </ParamSection>
      )}

      {clarityOptions.length > 0 && (
        <ParamSection title="清晰度">
          <SegmentedRow count={clarityOptions.length}>
            {clarityOptions.map((option) => (
              <SegmentButton key={option} active={value.clarity === option} onClick={() => onChange({ ...value, clarity: option })}>
                {option}
              </SegmentButton>
            ))}
          </SegmentedRow>
        </ParamSection>
      )}

      {ratioOptions.length > 0 && (
        <ParamSection title={composer ? "图片尺寸" : "比例"}>
          <div className={styles.ratioGrid}>
            {ratioOptions.map((option) => (
              <RatioTile
                key={option.value}
                option={option}
                active={value.ratio === option.value}
                onClick={() => onChange({ ...value, ratio: option.value })}
              />
            ))}
          </div>
        </ParamSection>
      )}
    </div>
  );

  return (
    <Popover
      opened={open}
      onChange={onOpenChange}
      width={composer ? 420 : 344}
      position={composer ? "top-start" : "bottom-start"}
      offset={8}
      withinPortal
      floatingStrategy="fixed"
      zIndex={1200}
      radius={12}
      shadow="none"
      middlewares={{ flip: true, shift: { padding: 12 }, inline: true }}
      positionDependencies={[value.quality, value.clarity, value.ratio, qualityOptions.length, clarityOptions.length, ratioOptions.length]}
      transitionProps={{ duration: 120, transition: "pop" }}
    >
      <Popover.Target>
        <button
          ref={triggerRef}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            if (!open) announceOpen();
            onOpenChange(!open);
          }}
          className={cn(styles.trigger, compact && styles.triggerCompact, composer && styles.triggerComposer)}
          aria-expanded={open}
          title="选择图片参数"
        >
          {compact ? <RectangleHorizontal className="h-3.5 w-3.5 shrink-0" /> : <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />}
          <span className={styles.triggerText}>{buildQualityRatioSummary(value, batchCount)}</span>
          <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-neutral-400 transition-transform", open && "rotate-180")} />
        </button>
      </Popover.Target>

      <Popover.Dropdown ref={panelRef} className={cn(styles.panel, composer && styles.panelComposer)}>
        {dropdownPanel}
      </Popover.Dropdown>
    </Popover>
  );
}

function ParamSection({ title, children }: ParamSectionProps) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionTitle}>{title}</div>
      {children}
    </section>
  );
}

function SegmentedRow({ children, count }: { children: ReactNode; count: number }) {
  return (
    <div className={styles.segmentedRow} style={{ gridTemplateColumns: `repeat(${Math.max(1, count)}, minmax(0, 1fr))` }}>
      {children}
    </div>
  );
}

function SegmentButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn(styles.segmentButton, active && styles.segmentButtonActive)}>
      {children}
    </button>
  );
}

function RatioTile({ option, active, onClick }: { option: RatioOption; active: boolean; onClick: () => void }) {
  const { width, height } = getRatioShapeSize(option);

  return (
    <button type="button" onClick={onClick} className={cn(styles.ratioTile, active && styles.ratioTileActive)}>
      <span className={styles.ratioShapeWrap}>
        <span className={styles.ratioShape} style={{ width, height } as CSSProperties} />
      </span>
      <span>{option.label}</span>
    </button>
  );
}

export type { ImageQuality, QualityRatioValue };
