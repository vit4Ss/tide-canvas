export const CANVAS_GROUP_FRAME_PAD = 28;
export const CANVAS_GROUP_TITLE_HEIGHT = 34;

export interface LayerLayoutNode {
  id: string;
  width: number;
  height: number;
  contentW?: number;
  contentH?: number;
}

export interface LayerLayoutMember {
  id: string;
  x: number;
  y: number;
  /** Translate visible-card x back to the node container's x coordinate. */
  containerOffsetX: number;
}

export interface LayerLayoutUnit {
  key: string;
  width: number;
  height: number;
  members: LayerLayoutMember[];
}

/**
 * Build compact, indivisible group units. Group members use a two-column
 * masonry layout so a storyboard's 2×2 reading order survives auto-arrange.
 */
export function buildLayerLayoutUnits(
  layerIds: readonly string[],
  nodeMap: ReadonlyMap<string, LayerLayoutNode>,
  groupOfNode: ReadonlyMap<string, string>,
  colGap: number,
  rowGap: number,
): LayerLayoutUnit[] {
  const idsByKey = new Map<string, string[]>();
  const keys: string[] = [];
  for (const id of layerIds) {
    const key = groupOfNode.get(id) ?? `node:${id}`;
    if (!idsByKey.has(key)) {
      idsByKey.set(key, []);
      keys.push(key);
    }
    idsByKey.get(key)!.push(id);
  }

  return keys.map((key) => {
    const ids = idsByKey.get(key)!;
    const nodes = ids.map((id) => nodeMap.get(id)!);
    const grouped = ids.some((id) => groupOfNode.has(id));
    const columnCount = Math.min(2, Math.max(1, nodes.length));
    const columnWidth = Math.max(...nodes.map((node) => node.contentW ?? node.width));
    const columnHeights = new Array<number>(columnCount).fill(0);
    const members: LayerLayoutMember[] = [];

    for (const node of nodes) {
      let column = 0;
      for (let index = 1; index < columnCount; index += 1) {
        if (columnHeights[index] < columnHeights[column]) column = index;
      }
      const visibleWidth = node.contentW ?? node.width;
      const visibleHeight = node.contentH ?? node.height;
      members.push({
        id: node.id,
        x: (grouped ? CANVAS_GROUP_FRAME_PAD : 0)
          + column * (columnWidth + colGap)
          + (columnWidth - visibleWidth) / 2,
        y: (grouped ? CANVAS_GROUP_FRAME_PAD + CANVAS_GROUP_TITLE_HEIGHT : 0)
          + columnHeights[column],
        containerOffsetX: (node.width - visibleWidth) / 2,
      });
      columnHeights[column] += visibleHeight + rowGap;
    }

    return {
      key,
      width: columnCount * columnWidth + colGap * (columnCount - 1)
        + (grouped ? CANVAS_GROUP_FRAME_PAD * 2 : 0),
      height: Math.max(0, ...columnHeights) - rowGap
        + (grouped ? CANVAS_GROUP_FRAME_PAD * 2 + CANVAS_GROUP_TITLE_HEIGHT : 0),
      members,
    };
  });
}

/** Pack whole units into the fewest height-bounded columns with no empty tail. */
export function packLayerLayoutUnits(
  units: readonly LayerLayoutUnit[],
  maxColumnHeight: number,
  rowGap: number,
): LayerLayoutUnit[][] {
  if (!units.length) return [];
  const singleColumnHeight = units.reduce((sum, unit) => sum + unit.height, 0)
    + rowGap * Math.max(0, units.length - 1);
  const columnCount = Math.max(1, Math.min(units.length, Math.ceil(singleColumnHeight / maxColumnHeight)));
  const columns: LayerLayoutUnit[][] = Array.from({ length: columnCount }, () => []);
  const heights = new Array<number>(columnCount).fill(0);
  for (const unit of units) {
    let target = 0;
    for (let column = 1; column < columnCount; column += 1) {
      if (heights[column] < heights[target]) target = column;
    }
    if (columns[target].length) heights[target] += rowGap;
    columns[target].push(unit);
    heights[target] += unit.height;
  }
  return columns;
}
