/* ============================================================================
   TableSkeleton / ListSkeleton — 加载态骨架屏。

   redesign-skill 审计项：加载态应匹配最终布局的形状（表格出表格骨架、
   卡片列表出卡片骨架），而不是一行「加载中…」文字。复用 admin.css 的
   `.skel` 微光扫过动画；宽度用确定性伪随机（同一格每次渲染一致），
   SSR 安全、无闪变，reduced-motion 下动画自动停（admin.css 全局兜底）。
   ============================================================================ */

export interface TableSkeletonProps {
  /** 骨架行数（default 6）。 */
  rows?: number;
  /** 骨架列数（default 6）。 */
  cols?: number;
}

/** `.adm-table` 形状的表格骨架。 */
export function TableSkeleton({ rows = 6, cols = 6 }: TableSkeletonProps) {
  // 确定性伪随机列宽 42–94px：视觉上像真实数据的参差，又不依赖 Math.random
  const w = (r: number, c: number) => 42 + ((r * 7 + c * 13) % 5) * 13;
  return (
    <table className="adm-table" aria-hidden="true">
      <thead>
        <tr>
          {Array.from({ length: cols }, (_, c) => (
            <th key={c}>
              <span
                className="skel"
                style={{ display: "inline-block", width: 48, height: 10, borderRadius: 4 }}
              />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }, (_, r) => (
          <tr key={r}>
            {Array.from({ length: cols }, (_, c) => (
              <td key={c}>
                <span
                  className="skel"
                  style={{ display: "inline-block", width: w(r, c), height: 12, borderRadius: 4 }}
                />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export interface ListSkeletonProps {
  /** 骨架块数（default 4）。 */
  rows?: number;
  /** 每块高度 px（default 56，匹配 .floor / .set-row 行高）。 */
  height?: number;
  /** 块间距 px（default 10）。 */
  gap?: number;
  /** true = 直接放在 #F5F5F7 灰场上（白卡形态）；false = 在白面板内（灰块形态）。 */
  onField?: boolean;
}

/** 卡片/行列表形状的骨架（楼层、工具、配置分组等非表格列表）。 */
export function ListSkeleton({ rows = 4, height = 56, gap = 10, onField = false }: ListSkeletonProps) {
  return (
    <div aria-hidden="true" style={{ display: "flex", flexDirection: "column", gap }}>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className={`skel${onField ? " skel-card" : ""}`}
          style={{ height, borderRadius: "var(--r-lg)" }}
        />
      ))}
    </div>
  );
}

export default TableSkeleton;
