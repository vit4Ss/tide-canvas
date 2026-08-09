import { z } from "zod";

const stringIdSchema = z.union([z.string(), z.number().finite()]).transform(String);
const finiteNumberSchema = z.number().finite();

export const persistedCanvasNodeSchema = z.looseObject({
  id: stringIdSchema.optional(),
  type: z.string().optional(),
  x: finiteNumberSchema.optional(),
  y: finiteNumberSchema.optional(),
  width: finiteNumberSchema.optional(),
  height: finiteNumberSchema.optional(),
  title: z.string().optional(),
});

export const persistedConnectionSchema = z.looseObject({
  id: stringIdSchema.optional(),
  sourceId: stringIdSchema.optional(),
  targetId: stringIdSchema.optional(),
  targetSlot: z.string().optional(),
  sourceOutput: z.string().optional(),
});

export const persistedCanvasGroupSchema = z.looseObject({
  id: stringIdSchema.optional(),
  title: z.string().optional(),
  color: z.string().optional(),
  nodeIds: z.array(stringIdSchema).catch([]),
});

/**
 * 顶层和子对象均使用 loose schema：生产校验只约束画布运行所需字段，未知字段
 * 必须原样保留，避免新版本打开旧画布后保存时破坏尚未识别的扩展能力。
 */
export const persistedCanvasDocumentSchema = z.looseObject({
  // 集合元素逐条校验与恢复，避免一个损坏节点导致整张画布被 array.parse 丢弃。
  nodes: z.array(z.unknown()).catch([]),
  connections: z.array(z.unknown()).catch([]),
  groups: z.array(z.unknown()).catch([]),
  skillRuns: z.unknown().optional(),
  skillRunState: z.unknown().optional(),
});

export type ParsedPersistedCanvasDocument = z.infer<typeof persistedCanvasDocumentSchema>;
