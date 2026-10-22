"use client";

import { type CSSProperties, type ReactNode } from "react";
import { Popover } from "@mantine/core";
import { ChevronDown, RectangleHorizontal, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import styles from "../styles/parameter-dropdown.module.css";
import type { ImageQuality, ParamSectionProps, QualityRatioValue, RatioOption } from "../types/quality-ratio";
import {
  CLARITY_OPTIONS,
  QUALITY_OPTIONS,
  RATIO_OPTIONS,
  buildQualityRatioSummary,
  getRatioShapeSize,
  normalizeBatchOptions,
} from "../utils/quality-ratio";

// 后台画质取值 → 友好名的补充映射（内置 QUALITY_OPTIONS 只有 low/standard/high，
// 而后台常用 medium 表示"标准"，与后端 normalizeQuality 的 standard→medium 对齐）。
const QUALITY_LABEL_ALIAS: Record<string, string> = {
  low: "低画质",
  standard: "标准画质",
  medium: "标准画质",
  high: "高画质",
};

interface QualityRatioDropdownProps {
  value: QualityRatioValue;
  onChange: (value: QualityRatioValue) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  qualities?: readonly string[];
  clarities?: readonly string[];
  ratios?: readonly string[];
  batchCount?: number;
  batchOptions?: readonly number[];
  onBatchChange?: (value: number) => void;
  compact?: boolean;
}

// 图片节点的画质、清晰度、画面比例与生成张数使用同一个参数面板。
export function QualityRatioDropdown({
  value,
  onChange,
  open,
  onOpenChange,
  qualities,
  clarities,
  ratios,
  batchCount,
  batchOptions,
  onBatchChange,
  compact = false,
}: QualityRatioDropdownProps) {
  // 直接渲染后台配置的取值(与创作台一致)，不再拿死白名单过滤——否则后台配的
  // "medium"(白名单只有 standard)、小写 "1k"(白名单是 "1K") 会被静默丢弃，
  // 表现为"画质/清晰度选不了"。value 用配置原值，label 尽量查内置友好名、查不到
  // 就回退原值。undefined = 未配置 → 用内置全集；[] = 后台明确全不勾 → 隐藏。
  const qualityOptions: { value: string; label: string }[] = (qualities ?? QUALITY_OPTIONS.map((o) => o.value)).map((v) => ({
    value: v,
    label: QUALITY_OPTIONS.find((o) => o.value === v)?.label ?? QUALITY_LABEL_ALIAS[v.toLowerCase()] ?? v,
  }));
  const clarityOptions: readonly string[] = clarities ?? CLARITY_OPTIONS;
  const ratioOptions = ratios
    ? ratios.map((v) => RATIO_OPTIONS.find((o) => o.value === v) ?? { value: v, label: v, w: 14, h: 14 })
    : RATIO_OPTIONS;
  const countOptions = batchCount != null && onBatchChange && batchOptions?.length
    ? normalizeBatchOptions(batchOptions)
    : [];

  const dropdownPanel = (
    <div className={styles.panelInner} onMouseDown={(event) => event.stopPropagation()}>
      {qualityOptions.length > 0 && (
        <ParamSection title="画质">
          <SegmentedRow count={Math.min(3, qualityOptions.length)}>
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
                {option.toUpperCase()}
              </SegmentButton>
            ))}
          </SegmentedRow>
        </ParamSection>
      )}

      {ratioOptions.length > 0 && (
        <ParamSection title="比例">
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

      {countOptions.length > 0 && (
        <ParamSection title="生成数量">
          <SegmentedRow count={countOptions.length}>
            {countOptions.map((count) => (
              <SegmentButton key={count} active={batchCount === count} onClick={() => onBatchChange?.(count)}>
                {count} 张
              </SegmentButton>
            ))}
          </SegmentedRow>
        </ParamSection>
      )}
    </div>
  );

  return (
    <Popover
      opened={open}
      onChange={onOpenChange}
      width={344}
      position="bottom-start"
      offset={8}
      withinPortal
      floatingStrategy="fixed"
      zIndex={110}
      radius={12}
      shadow="none"
      middlewares={{ flip: true, shift: { padding: 12 }, inline: true }}
      clickOutsideEvents={["pointerdown"]}
      positionDependencies={[value.quality, value.clarity, value.ratio, batchCount, qualityOptions.length, clarityOptions.length, ratioOptions.length, countOptions.length]}
      transitionProps={{ duration: 100, transition: "fade" }}
    >
      <Popover.Target>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpenChange(!open);
          }}
          className={cn(styles.trigger, compact && styles.triggerCompact)}
          aria-haspopup="dialog"
          aria-expanded={open}
          title="选择图片参数"
          onKeyDown={(event) => {
            if (event.key === "Escape" && open) {
              event.stopPropagation();
              onOpenChange(false);
            }
          }}
        >
          {compact ? <RectangleHorizontal className="h-3.5 w-3.5 shrink-0" /> : <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />}
          <span className={styles.triggerText}>{buildQualityRatioSummary(value, batchCount)}</span>
          <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
      </Popover.Target>

      <Popover.Dropdown role="dialog" aria-label="图片参数" className={styles.panel}>
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
    <button type="button" aria-pressed={active} onClick={onClick} className={cn(styles.segmentButton, active && styles.segmentButtonActive)}>
      {children}
    </button>
  );
}

function RatioTile({ option, active, onClick }: { option: RatioOption; active: boolean; onClick: () => void }) {
  const { width, height } = getRatioShapeSize(option, 20);

  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={cn(styles.ratioTile, active && styles.ratioTileActive)}>
      <span className={styles.ratioShapeWrap}>
        <span className={styles.ratioShape} data-auto={option.value === "auto" || undefined} style={{ width, height } as CSSProperties} />
      </span>
      <span>{option.label}</span>
    </button>
  );
}

export type { ImageQuality, QualityRatioValue };
