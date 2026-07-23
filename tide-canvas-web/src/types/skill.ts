// ============================================================================
// 技能(Skill)类型 — mirror Go model.Skill / handler/skill / admin/g2_skills。
// 技能 = 「提示词模板 + 指定模型 + 默认参数」的官方打包卡片,在 /chat、创作台
// 与画布节点以 chip 附着,发送时模板与用户描述合并生成。
// ============================================================================

export interface SkillVO {
  id: string;
  title: string;
  description: string;
  coverUrl: string;
  category: string;
  /** image | video | audio | text —— 卡片角标 + 各入口按模态过滤 */
  outputType: string;
  promptTemplate: string;
  /** 关联模型卡（AiModelVO.modelId 上游键；空 = 不指定） */
  modelId: string;
  /** JSON 对象串，如 {"aspectRatio":"16:9","resolution":"720P","duration":5} */
  defaultParams: string;
  authorName: string;
  /** 0 下架 / 1 上架 */
  status: number;
  sortOrder: number;
  useCount: number;
  createTime: string;
  updateTime: string;
}

export interface SkillQuery {
  pageNum?: number;
  pageSize?: number;
  keyword?: string;
  category?: string;
  outputType?: string;
  /** admin 专用：按状态过滤 */
  status?: number;
}

/** admin 新建/编辑技能（AdminSkillSaveDTO） */
export interface SkillSaveDTO {
  title: string;
  description?: string;
  coverUrl?: string;
  category?: string;
  outputType: string;
  promptTemplate: string;
  modelId?: string;
  defaultParams?: string;
  authorName?: string;
  status?: number;
  sortOrder?: number;
}

/** 分类目录（前后台同一份；分类存自由串，这里是推荐值） */
export const SKILL_CATEGORIES = [
  "专业影视",
  "商业广告",
  "短剧漫剧",
  "动漫游戏",
  "音乐MV",
  "自媒体创作",
  "通用技能",
] as const;

export const SKILL_OUTPUT_LABEL: Record<string, string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
  text: "文本",
};
