"use client";

import { useState, type MouseEvent as ReactMouseEvent } from "react";
import { QualityRatioDropdown } from "./components/quality-ratio-dropdown";
import { BatchCountDropdown } from "./components/batch-count-dropdown";
import type { QualityRatioValue } from "./types/quality-ratio";
export type { ImageClarity, ImageQuality, QualityRatioValue } from "./types/quality-ratio";
export { CLARITY_OPTIONS, QUALITY_OPTIONS, RATIO_OPTIONS, parseRatio } from "./utils/quality-ratio";

interface Props {
  value: QualityRatioValue;
  onChange: (value: QualityRatioValue) => void;
  qualities?: string[];
  clarities?: string[];
  ratios?: string[];
  compact?: boolean;
  batchCount?: number;
  batchOptions?: number[];
  onBatchChange?: (value: number) => void;
}


// 中文注释：保留旧入口，内部改为调用组件化后的两个下拉，画布内使用 Mantine Popover 让浮层跟随触发按钮定位。
export function QualityRatioPicker({ value, onChange, qualities, clarities, ratios, compact = false, batchCount, batchOptions, onBatchChange }: Props) {
  const [qualityOpen, setQualityOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const showBatch = batchCount != null && (batchOptions?.length ?? 0) > 0 && !!onBatchChange;


  const handleOpenQuality = (open: boolean) => {
    setQualityOpen(open);
    if (open) setBatchOpen(false);
  };

  const stop = (event: ReactMouseEvent) => event.stopPropagation();

  return (
    <div className="relative flex items-center gap-1" onMouseDown={stop}>
      <QualityRatioDropdown
        value={value}
        onChange={onChange}
        open={qualityOpen}
        onOpenChange={handleOpenQuality}
        qualities={qualities}
        clarities={clarities}
        ratios={ratios}
        compact={compact}
      />

      {showBatch && (
        <BatchCountDropdown
          value={batchCount}
          options={batchOptions}
          open={batchOpen}
          onOpenChange={(open) => {
            setBatchOpen(open);
            if (open) setQualityOpen(false);
          }}
          onChange={(next) => onBatchChange?.(next)}
        />
      )}
    </div>
  );
}