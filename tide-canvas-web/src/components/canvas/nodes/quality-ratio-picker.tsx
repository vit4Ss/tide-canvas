"use client";

import { useState, type MouseEvent as ReactMouseEvent } from "react";
import { QualityRatioDropdown } from "./components/quality-ratio-dropdown";
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


// 图片参数与生成张数共用一个入口，浮层跟随参数摘要定位。
export function QualityRatioPicker({ value, onChange, qualities, clarities, ratios, compact = false, batchCount, batchOptions, onBatchChange }: Props) {
  const [qualityOpen, setQualityOpen] = useState(false);
  const showBatch = batchCount != null && (batchOptions?.length ?? 0) > 0 && !!onBatchChange;

  const stop = (event: ReactMouseEvent) => event.stopPropagation();

  return (
    <div className="relative flex items-center gap-1" onMouseDown={stop}>
      <QualityRatioDropdown
        value={value}
        onChange={onChange}
        open={qualityOpen}
        onOpenChange={setQualityOpen}
        qualities={qualities}
        clarities={clarities}
        ratios={ratios}
        compact={compact}
        batchCount={showBatch ? batchCount : undefined}
        batchOptions={showBatch ? batchOptions : undefined}
        onBatchChange={showBatch ? onBatchChange : undefined}
      />
    </div>
  );
}
