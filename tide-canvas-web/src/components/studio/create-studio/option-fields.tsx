/* 生成参数选项区（画面比例 / 分辨率 / 质量 / 生成数量 / 清晰度 / 时长）— 从
   create-studio.tsx 抽出（纯移动，无逻辑改动）。各字段按类型与模型配置条件显隐，
   条件与原 JSX 完全一致。 */

import { QUALITY_LABEL } from "./constants";
import { ratioLabel, resolutionLabel } from "./utils";

export function OptionFields({
  isVideo,
  isAudio,
  ratioOpts,
  ratio,
  onRatioChange,
  resOpts,
  imgRes,
  onImgResChange,
  qualOpts,
  quality,
  onQualityChange,
  count,
  onCountChange,
  batchMin,
  batchMax,
  res,
  onResChange,
  durOpts,
  dur,
  onDurChange,
}: {
  isVideo: boolean;
  isAudio: boolean;
  ratioOpts: string[];
  ratio: string;
  onRatioChange: (v: string) => void;
  resOpts: string[];
  imgRes: string;
  onImgResChange: (v: string) => void;
  qualOpts: string[];
  quality: string;
  onQualityChange: (v: string) => void;
  count: number;
  onCountChange: (v: number) => void;
  batchMin: number;
  batchMax: number;
  res: string;
  onResChange: (v: string) => void;
  durOpts: string[];
  dur: string;
  onDurChange: (v: string) => void;
}) {
  return (
    <>
      {/* 画面比例 (configured ratios only) */}
      {!isAudio && ratioOpts.length > 0 && (
        <div className="ws-field col" id="fieldRatio">
          <label>画面比例</label>
          <div className="ws-ratios" id="ratios">
            {ratioOpts.map((r) => (
              <button
                key={r}
                type="button"
                className={`ratio${r === ratio ? " on" : ""}`}
                onClick={() => onRatioChange(r)}
              >
                {ratioLabel(r)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 分辨率 (image, configured resolutions only) */}
      {!isVideo && !isAudio && resOpts.length > 0 && (
        <div className="ws-field col" id="fieldImgRes">
          <label>分辨率</label>
          <div className="ws-ratios" id="imgResPills">
            {resOpts.map((r) => (
              <button
                key={r}
                type="button"
                className={`ratio${r === imgRes ? " on" : ""}`}
                onClick={() => onImgResChange(r)}
              >
                {resolutionLabel(r)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 质量 (image, configured qualities only) */}
      {!isVideo && !isAudio && qualOpts.length > 0 && (
        <div className="ws-field col" id="fieldQuality">
          <label>质量</label>
          <div className="ws-ratios" id="qualityPills">
            {qualOpts.map((q) => (
              <button
                key={q}
                type="button"
                className={`ratio${q === quality ? " on" : ""}`}
                onClick={() => onQualityChange(q)}
              >
                {QUALITY_LABEL[q] ?? q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 清晰度 (video, configured resolutions only) */}
      {isVideo && resOpts.length > 0 && (
        <div className="ws-field col" id="fieldRes">
          <label>清晰度</label>
          <div className="ws-ratios" id="resPills">
            {resOpts.map((r) => (
              <button
                key={r}
                type="button"
                className={`ratio${r === res ? " on" : ""}`}
                onClick={() => onResChange(r)}
              >
                {resolutionLabel(r)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 生成数量 (image). 始终显示；仅 1 个可选数量时滑块固定且禁用。 */}
      {!isVideo && !isAudio && (
        <div className="ws-field col" id="fieldCount">
          <label>
            生成数量 · <span id="countVal">{count}</span>
          </label>
          <input
            className="slider"
            id="count"
            type="range"
            min={batchMin}
            max={batchMax}
            step={1}
            value={count}
            disabled={batchMax <= batchMin}
            onChange={(e) => onCountChange(+e.target.value)}
          />
        </div>
      )}

      {/* 时长 (video, configured durations only) */}
      {isVideo && durOpts.length > 0 && (
        <div className="ws-field col" id="fieldDur">
          <label>时长</label>
          <div className="ws-ratios" id="durPills">
            {durOpts.map((d) => (
              <button
                key={d}
                type="button"
                className={`ratio${d === dur ? " on" : ""}`}
                onClick={() => onDurChange(d)}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
