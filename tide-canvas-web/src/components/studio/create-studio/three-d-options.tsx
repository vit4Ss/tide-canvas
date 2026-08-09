export function ThreeDOptions({
  enablePbr,
  onEnablePbrChange,
  faceCount,
  onFaceCountChange,
  generateType,
  onGenerateTypeChange,
  resultFormat,
  onResultFormatChange,
}: {
  enablePbr: boolean;
  onEnablePbrChange: (value: boolean) => void;
  faceCount: number;
  onFaceCountChange: (value: number) => void;
  generateType: "Normal" | "Geometry";
  onGenerateTypeChange: (value: "Normal" | "Geometry") => void;
  resultFormat: "" | "STL" | "USDZ" | "FBX";
  onResultFormatChange: (value: "" | "STL" | "USDZ" | "FBX") => void;
}) {
  return (
    <>
      <div className="ws-field col">
        <label>生成类型</label>
        <div className="ws-ratios">
          {(["Normal", "Geometry"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={`ratio${generateType === value ? " on" : ""}`}
              onClick={() => onGenerateTypeChange(value)}
            >
              {value === "Normal" ? "标准模型" : "纯几何"}
            </button>
          ))}
        </div>
      </div>

      <div className="ws-field col">
        <label>
          模型面数 · <span>{faceCount.toLocaleString()}</span>
        </label>
        <input
          className="slider"
          type="range"
          min={3000}
          max={1500000}
          step={1000}
          value={faceCount}
          onChange={(event) => onFaceCountChange(Number(event.target.value))}
        />
        <div className="ws-3d-range-note"><span>3,000</span><span>1,500,000</span></div>
      </div>

      <div className="ws-field col">
        <label>输出格式</label>
        <div className="ws-ratios ws-3d-formats">
          {([
            ["", "OBJ + GLB"],
            ["STL", "STL"],
            ["USDZ", "USDZ"],
            ["FBX", "FBX"],
          ] as const).map(([value, label]) => (
            <button
              key={value || "default"}
              type="button"
              className={`ratio${resultFormat === value ? " on" : ""}`}
              onClick={() => onResultFormatChange(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="ws-field ws-3d-pbr">
        <span>
          <strong>PBR 材质</strong>
          <small>生成物理渲染材质与贴图</small>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={enablePbr}
          className={`ws-3d-switch${enablePbr ? " on" : ""}`}
          onClick={() => onEnablePbrChange(!enablePbr)}
        >
          <i />
        </button>
      </div>
    </>
  );
}
