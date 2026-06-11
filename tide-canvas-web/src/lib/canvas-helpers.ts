import { generateNodeId, type CanvasNode, type CanvasGroup, type Connection } from "@/stores/use-canvas-store";

export const NODE_TYPE_TITLES: Record<string, string> = {
  text: "文本",
  image: "图片",
  video: "视频",
  video_compose: "视频合成",
  scene_3d: "导演台",
  audio: "音频",
  script: "脚本",
};

const NODE_TYPE_SIZES: Record<string, { width: number; height: number }> = {
  // 等比节点高度按默认比例的卡片高度设置，使连接线/缩略图对齐实际渲染
  image: { width: 608, height: 342 },
  video: { width: 608, height: 342 },
  video_compose: { width: 720, height: 580 },
  scene_3d: { width: 720, height: 360 },
  text: { width: 360, height: 200 },
  audio: { width: 360, height: 200 },
  script: { width: 360, height: 200 },
};

export function getNodeTitle(type: string): string {
  return NODE_TYPE_TITLES[type] || type;
}

export function getNodeSize(type: string): { width: number; height: number } {
  return NODE_TYPE_SIZES[type] || { width: 240, height: 160 };
}

export function createNode(type: string, worldX: number, worldY: number, existingNodes: CanvasNode[] = []): CanvasNode {
  const { width, height } = getNodeSize(type);
  const sameTypeCount = existingNodes.filter((n) => n.type === type).length;
  const baseTitle = getNodeTitle(type);
  const title = sameTypeCount === 0 ? `${baseTitle}节点` : `${baseTitle}节点 ${sameTypeCount + 1}`;
  return {
    id: generateNodeId(),
    type,
    x: worldX - width / 2,
    y: worldY - height / 2,
    width,
    height,
    title,
    status: "idle",
  };
}

interface LayoutGaps {
  layerGap: number; // 层间距（拉开「源 → 生成」流向）
  colGap: number;   // 层内子列间距
  rowGap: number;   // 列内节点间距
}

/**
 * 对一组节点做分层布局（左上角为原点，不落库）：按 depth 分层、源在左衍生在右。
 * <ul>
 *   <li><b>列数按高度决定</b>：每层默认单列；仅当单列高度超过上限（节点极多）时才折成多列，
 *       避免把 2~4 个输入横向铺开、拉长并交叉连线。</li>
 *   <li><b>重心排序</b>：层内按相邻层连接节点的平均位置排序（forward/backward 迭代），
 *       把相连节点纵向对齐，显著减少连线交叉。</li>
 * </ul>
 * 每层块整体垂直居中。返回各节点相对坐标与整组包围盒尺寸，供上层按连通分量竖向堆叠时加偏移。
 */
function layoutLayeredGrid(
  ids: string[],
  depthOf: (id: string) => number,
  nodeMap: Map<string, CanvasNode>,
  gaps: LayoutGaps,
  childrenMap: Map<string, string[]>,
  parentsMap: Map<string, string[]>,
): { pos: Map<string, { x: number; y: number }>; width: number; height: number } {
  const { layerGap, colGap, rowGap } = gaps;
  const realW = (n: CanvasNode) => n.contentW ?? n.width;
  const realH = (n: CanvasNode) => n.contentH ?? n.height;
  const MAX_COL_H = 1800; // 单列高度上限：超过才折多列；保证少量节点的层保持单列

  const idSet = new Set(ids);
  const layers = new Map<number, string[]>();
  for (const id of ids) {
    const d = depthOf(id);
    if (!layers.has(d)) layers.set(d, []);
    layers.get(d)!.push(id);
  }
  const depths = [...layers.keys()].sort((a, b) => a - b);

  // 层内重心排序：按相邻层连接节点的平均位置排序，使相连节点纵向对齐、减少连线交叉
  const order = new Map<number, string[]>(depths.map((d) => [d, [...layers.get(d)!]]));
  const baryOf = (id: string, neigh: Map<string, string[]>, adjDepth: number, idxMap: Map<string, number>, fallback: number) => {
    const ns = (neigh.get(id) ?? []).filter((m) => idSet.has(m) && depthOf(m) === adjDepth);
    if (!ns.length) return fallback;
    return ns.reduce((s, m) => s + (idxMap.get(m) ?? 0), 0) / ns.length;
  };
  for (let iter = 0; iter < 4; iter++) {
    for (let i = 1; i < depths.length; i++) {
      const d = depths[i], pd = depths[i - 1];
      const idxPrev = new Map(order.get(pd)!.map((id, k) => [id, k]));
      const cur = order.get(d)!;
      const curIdx = new Map(cur.map((id, k) => [id, k]));
      const bary = new Map(cur.map((id) => [id, baryOf(id, parentsMap, pd, idxPrev, curIdx.get(id)!)]));
      cur.sort((a, b) => (bary.get(a)! - bary.get(b)!) || (curIdx.get(a)! - curIdx.get(b)!));
    }
    for (let i = depths.length - 2; i >= 0; i--) {
      const d = depths[i], cd = depths[i + 1];
      const idxNext = new Map(order.get(cd)!.map((id, k) => [id, k]));
      const cur = order.get(d)!;
      const curIdx = new Map(cur.map((id, k) => [id, k]));
      const bary = new Map(cur.map((id) => [id, baryOf(id, childrenMap, cd, idxNext, curIdx.get(id)!)]));
      cur.sort((a, b) => (bary.get(a)! - bary.get(b)!) || (curIdx.get(a)! - curIdx.get(b)!));
    }
  }

  // 每层按高度上限决定列数（小层单列），按重心顺序顺序填充
  const blocks = depths.map((d) => {
    const layerIds = order.get(d)!;
    const n = layerIds.length;
    const singleH = layerIds.reduce((s, id) => s + realH(nodeMap.get(id)!), 0) + rowGap * Math.max(0, n - 1);
    const nCols = Math.max(1, Math.min(n, Math.ceil(singleH / MAX_COL_H)));
    const perCol = Math.ceil(n / nCols);
    const subCols: string[][] = [];
    for (let c = 0; c < nCols; c++) subCols.push(layerIds.slice(c * perCol, (c + 1) * perCol));
    const colW = Math.max(...layerIds.map((id) => realW(nodeMap.get(id)!)));
    const heights = subCols.map((col) => col.reduce((s, id) => s + realH(nodeMap.get(id)!), 0) + rowGap * Math.max(0, col.length - 1));
    const blockW = nCols * colW + colGap * (nCols - 1);
    const blockH = Math.max(0, ...heights);
    return { subCols, colW, blockW, blockH };
  });
  const maxH = Math.max(0, ...blocks.map((b) => b.blockH));

  const pos = new Map<string, { x: number; y: number }>();
  let x = 0;
  for (const b of blocks) {
    const blockTop = (maxH - b.blockH) / 2;
    for (let ci = 0; ci < b.subCols.length; ci++) {
      const colX = x + ci * (b.colW + colGap);
      let y = blockTop;
      for (const id of b.subCols[ci]) {
        const node = nodeMap.get(id)!;
        const w = realW(node);
        // 卡片在列宽内水平居中，并补偿卡片相对 node.width 容器的居中偏移
        pos.set(id, { x: colX + (b.colW - w) / 2 - (node.width - w) / 2, y });
        y += realH(node) + rowGap;
      }
    }
    x += b.blockW + layerGap;
  }
  return { pos, width: Math.max(0, x - layerGap), height: maxH };
}

/**
 * 孤立节点的素材网格：按阅读顺序（原 y、x）贪心填入当前最矮的列，列数取「网格接近 16:10 视口形状」，
 * 避免列优先堆叠把几张图摞成一条 1800px 的竖带。返回相对坐标与包围盒。
 */
function layoutMasonryGrid(
  ids: string[],
  nodeMap: Map<string, CanvasNode>,
  gaps: LayoutGaps,
): { pos: Map<string, { x: number; y: number }>; width: number; height: number } {
  const { colGap, rowGap } = gaps;
  const realW = (n: CanvasNode) => n.contentW ?? n.width;
  const realH = (n: CanvasNode) => n.contentH ?? n.height;
  const n = ids.length;
  const colW = Math.max(...ids.map((id) => realW(nodeMap.get(id)!)));
  const avgH = ids.reduce((s, id) => s + realH(nodeMap.get(id)!), 0) / n;
  // 列数²·colW ≈ 16:10 · n·avgH·colW → 网格宽高比接近常见视口
  const nCols = Math.max(1, Math.min(n, Math.round(Math.sqrt((1.6 * n * avgH) / Math.max(1, colW)))));

  const colHs = new Array<number>(nCols).fill(0);
  const pos = new Map<string, { x: number; y: number }>();
  for (const id of ids) {
    let ci = 0;
    for (let c = 1; c < nCols; c++) if (colHs[c] < colHs[ci]) ci = c;
    const node = nodeMap.get(id)!;
    const w = realW(node);
    // 卡片在列宽内水平居中，并补偿卡片相对 node.width 容器的居中偏移
    pos.set(id, { x: ci * (colW + colGap) + (colW - w) / 2 - (node.width - w) / 2, y: colHs[ci] });
    colHs[ci] += realH(node) + rowGap;
  }
  return {
    pos,
    width: nCols * colW + colGap * (nCols - 1),
    height: Math.max(0, ...colHs) - rowGap,
  };
}

/**
 * 自动整理（纯函数，返回批量位置，调用方单次 set 落库）：
 * <ul>
 *   <li><b>连通分量分 band</b>：每条有连线的链路各占一条横向 band（分层网格，源在左衍生在右），
 *       孤立节点不会与链路在同一水平线上对齐，避免「看起来相连其实没连」的误读。</li>
 *   <li><b>分组不拆散</b>：同组成员并入同一连通分量，整理后仍聚在同一 band，组框不会被拉穿全图。</li>
 *   <li><b>顺序稳定</b>：链路 band 按整理前的垂直位置排序，多次整理不乱跳；孤立节点排成素材网格置底。</li>
 *   <li><b>原地整理</b>：整体包围盒中心对齐整理前的中心，不把内容搬去世界原点。</li>
 * </ul>
 */
export function autoArrangeNodes(
  nodes: CanvasNode[],
  connections: Connection[],
  groups: CanvasGroup[] = [],
): Array<{ id: string; x: number; y: number }> {
  if (nodes.length === 0) return [];
  const gaps: LayoutGaps = { layerGap: 160, colGap: 40, rowGap: 40 };
  const bandGap = 140; // 不同连通分量（独立链路 / 孤立节点组）之间的竖向间距，强调彼此无关
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const realW = (n: CanvasNode) => n.contentW ?? n.width;
  const realH = (n: CanvasNode) => n.contentH ?? n.height;

  // 整理前内容包围盒中心：整理后整体对齐回来，保持「原地整理」
  let oldMinX = Infinity, oldMinY = Infinity, oldMaxX = -Infinity, oldMaxY = -Infinity;
  for (const n of nodes) {
    oldMinX = Math.min(oldMinX, n.x);
    oldMinY = Math.min(oldMinY, n.y);
    oldMaxX = Math.max(oldMaxX, n.x + realW(n));
    oldMaxY = Math.max(oldMaxY, n.y + realH(n));
  }

  // 有向：children + parents + indeg（分层/重心排序用）；并查集：求无向连通分量
  const children = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  const parents = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  const indeg = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const parent = new Map<string, string>(nodes.map((n) => [n.id, n.id]));
  const find = (a: string): string => {
    let r = a;
    while (parent.get(r) !== r) r = parent.get(r)!;
    while (parent.get(a) !== r) {
      const next = parent.get(a)!;
      parent.set(a, r);
      a = next;
    }
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const c of connections) {
    if (nodeMap.has(c.sourceId) && nodeMap.has(c.targetId) && c.sourceId !== c.targetId) {
      children.get(c.sourceId)!.push(c.targetId);
      parents.get(c.targetId)!.push(c.sourceId);
      indeg.set(c.targetId, (indeg.get(c.targetId) ?? 0) + 1);
      union(c.sourceId, c.targetId);
    }
  }
  // 分组成员强制同一连通分量：整理不把组拆散（组框由成员位置实时计算，拆散会拉穿全图）
  for (const g of groups) {
    const members = g.nodeIds.filter((id) => nodeMap.has(id));
    for (let i = 1; i < members.length; i++) union(members[0], members[i]);
  }

  // 最长路径分层（Kahn 拓扑序）；连通分量间边不相交，全局计算即可得各分量内正确层级
  const depth = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const indegLeft = new Map(indeg);
  const queue = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  while (queue.length) {
    const id = queue.shift()!;
    for (const ch of children.get(id) ?? []) {
      depth.set(ch, Math.max(depth.get(ch) ?? 0, (depth.get(id) ?? 0) + 1));
      indegLeft.set(ch, (indegLeft.get(ch) ?? 0) - 1);
      if ((indegLeft.get(ch) ?? 0) === 0) queue.push(ch);
    }
  }
  // 若存在环，环内节点保持初始 depth 0，仍可参与布局（不致报错）

  // 分连通分量（保留节点原始顺序）
  const compMap = new Map<string, string[]>();
  for (const n of nodes) {
    const r = find(n.id);
    if (!compMap.has(r)) compMap.set(r, []);
    compMap.get(r)!.push(n.id);
  }
  const comps = [...compMap.values()];
  // 链路 band 按整理前的垂直位置排序（顶部优先），多次整理顺序稳定、不乱跳
  const compTop = (c: string[]) => Math.min(...c.map((id) => nodeMap.get(id)!.y));
  const compLeft = (c: string[]) => Math.min(...c.map((id) => nodeMap.get(id)!.x));
  const linked = comps
    .filter((c) => c.length >= 2)
    .sort((a, b) => compTop(a) - compTop(b) || compLeft(a) - compLeft(b));
  // 孤立节点按阅读顺序（y 优先、x 次之）排成素材网格，置于所有链路之下
  const singletons = comps
    .filter((c) => c.length === 1)
    .map((c) => c[0])
    .sort((a, b) => {
      const na = nodeMap.get(a)!;
      const nb = nodeMap.get(b)!;
      return na.y - nb.y || na.x - nb.x;
    });

  const depthOf = (id: string) => depth.get(id) ?? 0;

  // 组装各 band：每条链路（含成组的素材簇）一条，孤立节点素材网格垫底
  const bands: { ids: string[]; pos: Map<string, { x: number; y: number }>; height: number }[] = [];
  for (const comp of linked) {
    const { pos, height } = layoutLayeredGrid(comp, depthOf, nodeMap, gaps, children, parents);
    bands.push({ ids: comp, pos, height });
  }
  if (singletons.length) {
    const { pos, height } = layoutMasonryGrid(singletons, nodeMap, gaps);
    bands.push({ ids: singletons, pos, height });
  }

  // 竖向堆叠各 band（相对坐标），同时统计新布局包围盒
  const placed = new Map<string, { x: number; y: number }>();
  let offsetY = 0;
  let totalW = 0;
  for (const band of bands) {
    let bandW = 0;
    for (const id of band.ids) {
      const p = band.pos.get(id)!;
      placed.set(id, { x: p.x, y: offsetY + p.y });
      bandW = Math.max(bandW, p.x + realW(nodeMap.get(id)!));
    }
    totalW = Math.max(totalW, bandW);
    offsetY += band.height + bandGap;
  }
  const totalH = offsetY - bandGap;

  // 原地整理：新包围盒中心对齐旧中心
  const dx = (oldMinX + oldMaxX) / 2 - totalW / 2;
  const dy = (oldMinY + oldMaxY) / 2 - totalH / 2;
  return nodes.map((n) => {
    const p = placed.get(n.id)!;
    return { id: n.id, x: Math.round(p.x + dx), y: Math.round(p.y + dy) };
  });
}
